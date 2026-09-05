// controllers/user/Clinic/clinicCheckoutController.js
const Clinic = require('../../../models/Clinic');
const Doctor = require('../../../models/Doctor');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { calculateHaversine } = require('../../../utils/helpers');
const { 
    createRazorpayOrder, 
    verifyRazorpaySignature, 
    fetchAndMapRazorpayPayment 
} = require('../../../utils/razorpay');

const moment = require('moment');
const crypto = require('crypto');
const mongoose = require('mongoose');

// ==========================================
// 💡 SECURE CLINIC BILLING CALCULATION HELPER
// ==========================================
const calculateClinicBillHelper = async ({
    userId,
    clinicId,
    doctorId,
    consultationType = 'Clinic Visit', // 'Clinic Visit' | 'Video Consult' | 'Home Visit'
    bookingType = 'Appointment',      // 'Appointment' | 'Admission' | 'Daycare' | 'Emergency'
    triageLevel = 'Routine',
    patients = [],
    address = null,
    userLat,
    userLng,
    wardId,
    bedId,
    startDate,
    endDate,
    couponCode
}) => {
    // 🛡️ 1. Validate Clinic
    if (!clinicId || !mongoose.Types.ObjectId.isValid(clinicId)) {
        throw new Error("Valid Clinic ID (clinicId) is required.");
    }

    const clinic = await Clinic.findOne({
        _id: clinicId,
        $or: [{ Accountverify: 'Approved' }, { profileStatus: 'Approved' }],
        isActive: true
    }).lean();

    if (!clinic) {
        throw new Error("Clinic not found, suspended, or not accepting appointments.");
    }

    // 🛡️ 2. Validate Patients / Family Members
    const validPatients = Array.isArray(patients) && patients.length > 0
        ? patients.map(p => ({
            patientName: p.patientName || p.name || "Patient",
            patientAge: Number(p.patientAge || p.age || 25),
            gender: p.gender || "Male",
            relation: p.relation || "Self",
            reasonForVisit: p.reasonForVisit || p.reason || "",
            isMainUser: Boolean(p.isMainUser)
        }))
        : [{
            patientName: "Self",
            patientAge: 25,
            gender: "Male",
            relation: "Self",
            reasonForVisit: "General Consultation",
            isMainUser: true
        }];

    const patientCount = validPatients.length;

    // 🛡️ 3. Resolve Doctor & 3-Way Consultation Fee
    let doctor = null;
    let baseConsultationFeePerPatient = 0;

    if (doctorId && mongoose.Types.ObjectId.isValid(doctorId)) {
        doctor = await Doctor.findOne({
            _id: doctorId,
            clinicId,
            profileStatus: 'Approved',
            isActive: true
        }).lean();

        if (!doctor) {
            throw new Error("Selected Doctor is currently unavailable at this clinic.");
        }

        // Dynamically resolve fee based on consultation type
        if (consultationType === 'Home Visit') {
            if (doctor.consultationStatus?.home === false) {
                throw new Error(`Dr. ${doctor.name} is not available for Home Visits.`);
            }
            baseConsultationFeePerPatient = Number(doctor.fees?.home || 0);
        } else if (consultationType === 'Video Consult' || consultationType === 'Online') {
            if (doctor.consultationStatus?.online === false) {
                throw new Error(`Dr. ${doctor.name} is not available for Online Video Consultations.`);
            }
            baseConsultationFeePerPatient = Number(doctor.fees?.online || 0);
        } else {
            // Default: Clinic Visit (OPD)
            if (doctor.consultationStatus?.clinic === false) {
                throw new Error(`Dr. ${doctor.name} is not available for Clinic Visits.`);
            }
            baseConsultationFeePerPatient = Number(doctor.fees?.clinic || 0);
        }
    } else {
        // Flat Clinic General OPD Fee fallback if no specific doctor selected
        baseConsultationFeePerPatient = Number(clinic.amount || 500);
    }

    const totalConsultationFee = baseConsultationFeePerPatient * patientCount;

    // 🛡️ 4. Resolve Ward & Bed Stay Charges (Daycare / Admission)
    let bed = null;
    let ward = null;
    let totalBedCharges = 0;
    let stayDurationDays = 0;
    let finalStartDate = null;
    let finalEndDate = null;

    if (bedId && mongoose.Types.ObjectId.isValid(bedId)) {
        bed = await Bed.findOne({ _id: bedId, clinicId });
        if (!bed) throw new Error("Selected bed unit not found in this clinic.");
        if (bed.status === 'Maintenance') throw new Error("Selected bed is currently under maintenance.");

        ward = await Ward.findOne({ _id: bed.wardId, clinicId }).lean();

        finalStartDate = startDate ? moment(startDate).startOf('day').toDate() : moment().startOf('day').toDate();
        finalEndDate = endDate ? moment(endDate).endOf('day').toDate() : moment().add(1, 'days').endOf('day').toDate();

        stayDurationDays = Math.max(1, moment(finalEndDate).diff(moment(finalStartDate), 'days'));

        // Double Booking Conflict Validation
        const isBedOccupied = await Appointment.findOne({
            bedId,
            clinicId,
            status: { $in: ['Confirmed', 'In-Progress', 'Clinic-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: finalEndDate } },
                { endDate: { $gte: finalStartDate } }
            ]
        });

        if (isBedOccupied) {
            throw new Error(`Bed ${bed.bedNumber} is already booked for the selected date range. Please choose another bed.`);
        }

        const bedRatePerDay = Number(bed.pricePerDay || ward?.pricePerDay || 500);
        totalBedCharges = bedRatePerDay * stayDurationDays;
    }

    // 🛡️ 5. Distance Calculation for Home Visit
    let visitCharges = 0;
    let distanceInKm = 0;

    let parsedAddress = address;
    if (typeof address === 'string') {
        try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
    }

    if (consultationType === 'Home Visit') {
        const uLat = Number(userLat || parsedAddress?.lat || parsedAddress?.location?.lat);
        const uLng = Number(userLng || parsedAddress?.lng || parsedAddress?.location?.lng);
        const cLat = Number(clinic.location?.lat || clinic.location?.coordinates?.[1]);
        const cLng = Number(clinic.location?.lng || clinic.location?.coordinates?.[0]);

        if (uLat && uLng && cLat && cLng) {
            distanceInKm = calculateHaversine(uLat, uLng, cLat, cLng);

            // Radius Limit Check
            const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Clinic', isActive: true });
            const maxRadius = limitConfig ? limitConfig.kmLimit : 50;
            if (distanceInKm > maxRadius) {
                throw new Error(`Your address is ${distanceInKm} km away. Maximum clinic home visit service radius is ${maxRadius} km.`);
            }

            // Standard home visit distance tier
            const fixedDistance = 5; // 5 KM base
            const pricePerKM = 15;
            if (distanceInKm > fixedDistance) {
                visitCharges = Math.round((distanceInKm - fixedDistance) * pricePerKM);
            }
        }
    }

    // 🛡️ 6. Emergency Priority Surcharge
    let extraCharges = 0;
    if (triageLevel === 'Emergency' || bookingType === 'Emergency') {
        extraCharges = 300; // Flat emergency fast-track fee
    }

    const subtotal = totalConsultationFee + totalBedCharges + visitCharges + extraCharges;

    // 🛡️ 7. Coupon Discount Verification
    let couponDiscount = 0;
    let validCouponId = null;
    let appliedCouponCode = "";

    if (couponCode) {
        const cleanCode = String(couponCode).toUpperCase().trim();
        const now = new Date();

        const coupon = await Coupon.findOne({
            couponName: cleanCode,
            isActive: true,
            startDate: { $lte: now },
            expiryDate: { $gte: now },
            $or: [
                { vendorId: clinicId, vendorType: 'Clinic' },
                { isAdminCreated: true, vendorType: { $in: ['Clinic', 'Doctor', 'All'] } }
            ]
        });

        if (!coupon) throw new Error(`Coupon '${cleanCode}' is invalid or expired.`);
        if (subtotal < (coupon.minOrderAmount || 0)) {
            throw new Error(`Minimum booking amount of ₹${coupon.minOrderAmount} required for coupon '${cleanCode}'.`);
        }

        if (userId && coupon.usedBy) {
            const userUsage = coupon.usedBy.find(u => u.userId?.toString() === userId.toString());
            if (userUsage && userUsage.usageCount >= (coupon.maxUsagePerUser || 1)) {
                throw new Error(`Coupon usage limit reached for '${cleanCode}'.`);
            }
        }

        couponDiscount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
        validCouponId = coupon._id;
        appliedCouponCode = coupon.couponName;
    }

    const totalAmount = Math.max(0, subtotal - couponDiscount);

    // 🛡️ 8. COD / Pay at Clinic Policy Check
    const codConfig = await CodConfig.findOne({ vendorType: 'Clinic' });
    const isCodAvailable = codConfig ? Boolean(codConfig.isCodAvailable) : true;

    return {
        clinic,
        doctor,
        ward,
        bed,
        validPatients,
        parsedAddress,
        distanceInKm,
        isCodAvailable,
        dates: {
            startDate: finalStartDate,
            endDate: finalEndDate,
            stayDurationDays
        },
        pricingBreakdown: {
            baseFee: totalConsultationFee,
            originalBaseFee: baseConsultationFeePerPatient,
            patientsCount: patientCount,
            bedCharges: totalBedCharges,
            visitCharges: visitCharges,
            extraCharges: extraCharges,
            discountAmount: Math.round(couponDiscount),
            subtotal: Math.round(subtotal)
        },
        couponDetails: {
            couponId: validCouponId,
            couponCode: appliedCouponCode,
            discountValue: Math.round(couponDiscount)
        },
        totalAmount: Math.round(totalAmount)
    };
};

// ==========================================
// 1. CALCULATE BILL BREAKDOWN (POST /calculate)
// ==========================================
const calculateCheckoutBill = async (req, res) => {
    try {
        const userId = req.user.id;
        const calculation = await calculateClinicBillHelper({
            userId,
            ...req.body
        });

        res.json({
            success: true,
            clinic: {
                _id: calculation.clinic._id,
                clinicName: calculation.clinic.clinicName || calculation.clinic.name,
                city: calculation.clinic.city,
                address: calculation.clinic.address
            },
            doctor: calculation.doctor ? {
                _id: calculation.doctor._id,
                name: calculation.doctor.name,
                speciality: calculation.doctor.speciality,
                fees: calculation.doctor.fees
            } : null,
            wardBed: calculation.bed ? {
                wardName: calculation.ward?.name,
                bedNumber: calculation.bed.bedNumber,
                stayDurationDays: calculation.dates.stayDurationDays
            } : null,
            patients: calculation.validPatients,
            distance: calculation.distanceInKm ? `${calculation.distanceInKm.toFixed(1)} km` : null,
            orderRestrictions: {
                isCodAvailable: calculation.isCodAvailable
            },
            pricingBreakdown: calculation.pricingBreakdown,
            couponDetails: calculation.couponDetails,
            totalPayableAmount: calculation.totalAmount
        });

    } catch (error) {
        console.error("Calculate Clinic Checkout Error:", error.message);
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. BOOK APPOINTMENT & INITIATE PAYMENT (POST /book)
// ==========================================
const bookClinicAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            clinicId,
            doctorId,
            consultationType = 'Clinic Visit',
            bookingType = 'Appointment',
            triageLevel = 'Routine',
            appointmentDate,
            appointmentTime,
            patients,
            address,
            userLat,
            userLng,
            wardId,
            bedId,
            startDate,
            endDate,
            couponCode,
            clinicalNote = "",
            paymentMethod = 'COD' // 'COD' (Pay At Clinic) | 'Online' (Razorpay)
        } = req.body;

        const activePaymentMethod = paymentMethod || 'COD';

        // 1. Calculate & Validate all bill parameters
        const calculation = await calculateClinicBillHelper({
            userId,
            clinicId,
            doctorId,
            consultationType,
            bookingType,
            triageLevel,
            patients,
            address,
            userLat,
            userLng,
            wardId,
            bedId,
            startDate,
            endDate,
            couponCode
        });

        // 2. COD Policy Enforcement
        if (activePaymentMethod === 'COD' && calculation.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Pay at Clinic (COD) is currently disabled. Please pay online to complete booking."
            });
        }

        // 3. Generate Unique Booking ID (e.g., HK-CLN-748291)
        const bookingId = `HK-CLN-${Math.floor(100000 + Math.random() * 900000)}`;

        // 4. Generate Daily Queue Token Number for OPD Clinic Visits
        let tokenNumber = null;
        const targetApptDate = appointmentDate ? moment(appointmentDate).toDate() : new Date();

        if (consultationType === 'Clinic Visit') {
            const todayStart = moment(targetApptDate).startOf('day').toDate();
            const todayEnd = moment(targetApptDate).endOf('day').toDate();

            const existingCount = await Appointment.countDocuments({
                clinicId,
                consultationType: 'Clinic Visit',
                appointmentDate: { $gte: todayStart, $lte: todayEnd }
            });
            tokenNumber = existingCount + 1; // Token #1, #2, #3...
        }

        // 5. Razorpay Order Creation (if Online)
        let rzpOrder = null;
        if (activePaymentMethod !== 'COD' && calculation.totalAmount > 0) {
            rzpOrder = await createRazorpayOrder(
                calculation.totalAmount,
                `rcpt_${bookingId}_${Date.now()}`
            );
        }

        // 6. Create Unified Appointment in Database
        const appointment = await Appointment.create({
            bookingId,
            userId,
            clinicId,
            doctorId: doctorId || null,
            bedId: bedId || null,
            wardName: calculation.ward?.name || "",
            bedNumber: calculation.bed?.bedNumber || "",
            bookingType: bedId ? 'Admission' : (bookingType || 'Appointment'),
            consultationType,
            triageLevel,
            tokenNumber,
            appointmentDate: targetApptDate,
            appointmentTime: appointmentTime || "Immediate",
            startDate: calculation.dates.startDate,
            endDate: calculation.dates.endDate,
            stayDuration: calculation.dates.stayDurationDays,
            patients: calculation.validPatients,
            address: calculation.parsedAddress,
            bookingReason: clinicalNote,
            clinicalSummary: {
                chiefComplaint: clinicalNote
            },
            pricingBreakdown: calculation.pricingBreakdown,
            couponDetails: calculation.couponDetails,
            totalAmount: calculation.totalAmount,
            paymentMethod: activePaymentMethod,
            paymentStatus: activePaymentMethod === 'COD' ? 'Pending' : 'Pending',
            status: activePaymentMethod === 'COD' ? 'Confirmed' : 'Pending',
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        // 7. Lock Bed Status if Admitted
        if (calculation.bed) {
            await Bed.findByIdAndUpdate(calculation.bed._id, {
                $set: { status: 'Occupied', currentAppointmentId: appointment._id }
            });
            if (calculation.ward) {
                await Ward.findByIdAndUpdate(calculation.ward._id, {
                    $inc: { availableBeds: -1 }
                });
            }
        }

        // 8. COD / Pay at Clinic Instant Response
        if (activePaymentMethod === 'COD' || calculation.totalAmount === 0) {
            if (calculation.couponDetails?.couponId) {
                await Coupon.findByIdAndUpdate(calculation.couponDetails.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: "Appointment booked successfully! Pay at Clinic on arrival.",
                bookingId: appointment.bookingId,
                tokenNumber: appointment.tokenNumber,
                data: appointment
            });
        }

        // 9. Online Razorpay Checkout Response
        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: "Razorpay order initiated for clinic booking.",
            key: razorpayKey,
            key_id: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: calculation.totalAmount,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: appointment.bookingId,
            appointmentId: appointment._id,
            tokenNumber: appointment.tokenNumber,
            data: {
                ...appointment._doc,
                key: razorpayKey,
                razorpayOrderId: rzpOrder.id
            }
        });

    } catch (error) {
        console.error("Book Clinic Appointment Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. VERIFY RAZORPAY PAYMENT (POST /verify-payment)
// ==========================================
const verifyClinicPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            appointmentId,
            bookingId,
            razorpayOrderId,
            razorpay_order_id,
            razorpayPaymentId,
            razorpay_payment_id,
            razorpaySignature,
            razorpay_signature
        } = req.body;

        const targetId = appointmentId || bookingId;
        const rzpOrderId = razorpayOrderId || razorpay_order_id;
        const rzpPaymentId = razorpayPaymentId || razorpay_payment_id;
        const rzpSignature = razorpaySignature || razorpay_signature;

        if (!targetId || !rzpOrderId || !rzpPaymentId || !rzpSignature) {
            return res.status(400).json({ success: false, message: "Missing required Razorpay verification tokens." });
        }

        // Verify Crypto Signature
        let isVerified = false;
        try {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        } catch (e) {
            const secret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/["']/g, "").trim();
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(`${rzpOrderId}|${rzpPaymentId}`)
                .digest('hex');
            isVerified = (expectedSignature === rzpSignature);
        }

        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed." });
        }

        const appointment = await Appointment.findOne({
            $or: [
                { _id: targetId },
                { bookingId: targetId },
                { "paymentDetails.razorpayOrderId": rzpOrderId }
            ],
            userId
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        let rzpDetails = null;
        try {
            rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
        } catch (e) {
            rzpDetails = null;
        }

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = 'Online';
        appointment.status = 'Confirmed';
        appointment.paymentDetails = rzpDetails || {
            razorpayPaymentId: rzpPaymentId,
            razorpayOrderId: rzpOrderId,
            razorpaySignature: rzpSignature,
            paidAt: new Date()
        };

        await appointment.save();

        // Update Coupon usage counter
        if (appointment.couponDetails?.couponId) {
            await Coupon.findByIdAndUpdate(appointment.couponDetails.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        res.json({
            success: true,
            message: "Payment verified successfully & appointment confirmed!",
            bookingId: appointment.bookingId,
            tokenNumber: appointment.tokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Verify Clinic Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET MY CLINIC APPOINTMENTS (GET /my-appointments)
// ==========================================
const getMyClinicAppointments = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, consultationType } = req.query;

        let query = { 
            userId,
            clinicId: { $ne: null, $exists: true }
        };

        if (status) query.status = status;
        if (consultationType) query.consultationType = consultationType;

        const appointments = await Appointment.find(query)
            .select('bookingId tokenNumber appointmentDate appointmentTime consultationType bookingType status paymentStatus totalAmount clinicId doctorId bedId')
            .populate('clinicId', 'clinicName name address city image')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            count: appointments.length,
            data: appointments
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. GET SINGLE APPOINTMENT DETAILS (GET /appointment/:id)
// ==========================================
const getSingleClinicAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const appointment = await Appointment.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            userId
        })
        .populate('clinicId', 'clinicName name address city state phoneNumber email image location')
        .populate('doctorId', 'name speciality qualification experienceYears profileImage phone')
        .populate({
            path: 'bedId',
            select: 'bedNumber pricePerDay status',
            populate: { path: 'wardId', select: 'name type' }
        })
        .populate('couponDetails.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment details not found." });
        }

        res.json({
            success: true,
            data: appointment
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateCheckoutBill,
    bookClinicAppointment,
    verifyClinicPayment,
    getMyClinicAppointments,
    getSingleClinicAppointment
};