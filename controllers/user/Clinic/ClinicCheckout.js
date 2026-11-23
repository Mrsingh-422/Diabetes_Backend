// controllers/user/Clinic/ClinicCheckoutController.js

const Appointment = require('../../../models/Appointment');
const Clinic = require('../../../models/Clinic');
const Doctor = require('../../../models/Doctor');
const Ambulance = require('../../../models/Ambulance');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const mongoose = require('mongoose');
const { assignOpdTokenToAppointment, getOpdTokenQueueStatus } = require('../../../utils/opdTokenHelper');


const crypto = require('crypto');
const {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchAndMapRazorpayPayment
} = require('../../../utils/razorpay');

// ==========================================
// 💡 HELPER: SAFE JSON STRING PARSER (FOR FORMDATA)
// ==========================================
const parseField = (val) => {
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
};

// ==========================================
// 💡 HELPER: SAFE BILL CALCULATOR ENGINE
// ==========================================
const calculateClinicBillHelper = async ({
    clinicId,
    bookingType = 'OPD', // 'OPD', 'IPD', 'EMERGENCY'
    doctor = {},
    ward = null,
    ambulance = null,
    couponCode = null
}) => {
    // 1. Verify Clinic
    const clinic = await Clinic.findById(clinicId).select('name clinicName city state address image');
    if (!clinic) throw new Error("Clinic facility not found.");
    if (clinic.isActive === false) throw new Error("This clinic facility is currently inactive.");

    let doctorFee = 0;
    let bedFee = 0;
    let ambulanceFee = 0;

    // 2. Verify Doctor & Fee
    const doctorId = doctor?.doctorId || doctor?._id;
    let verifiedDoctor = null;

    if (doctorId) {
        verifiedDoctor = await Doctor.findById(doctorId).select('name speciality qualification fees profileImage averageRating dutyStatus');
        if (verifiedDoctor) {
            const mode = doctor.mode || 'clinic';

            if (mode === 'video' || mode === 'Video Consult' || mode === 'online' || mode === 'videoConsultFee') {
                doctorFee = Number(verifiedDoctor.fees?.online || doctor.fee || 500);
            } else if (mode === 'home' || mode === 'Home Visit' || mode === 'homeVisitFee') {
                doctorFee = Number(verifiedDoctor.fees?.home || doctor.fee || 1200);
            } else {
                doctorFee = Number(verifiedDoctor.fees?.clinic || doctor.fee || 800);
            }
        }
    }

    // 3. Verify IPD / Emergency Inpatient Bed Fee (with wardId & bedId)
    let verifiedWard = null;
    if ((bookingType === 'IPD' || bookingType === 'EMERGENCY') && ward && ward.bedId) {
        const pricePerDay = Number(ward.pricePerDay || 600);
        let totalDays = Number(ward.totalDays || 1);

        if (ward.startDate && ward.endDate) {
            const start = new Date(ward.startDate);
            const end = new Date(ward.endDate);
            const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            totalDays = Math.max(1, diffDays);
        }

        bedFee = pricePerDay * totalDays;

        verifiedWard = {
            wardId: ward.wardId || null,
            bedId: ward.bedId || null,
            wardName: ward.wardName || "Observation Ward",
            wardType: ward.wardType || "Observation",
            bedNumber: ward.bedNumber || "S-01",
            startDate: ward.startDate,
            endDate: ward.endDate,
            totalDays,
            pricePerDay,
            totalBedPrice: bedFee
        };
    }

    // 4. Verify Emergency Ambulance & Supporting Staff
    let verifiedAmbulance = null;
    if (bookingType === 'EMERGENCY' && ambulance && ambulance.ambulanceId) {
        const ambDoc = await Ambulance.findById(ambulance.ambulanceId);

        const rideType = ambulance.rideType || 'ONE-WAY RIDE';
        let ridePrice = 0;

        if (ambDoc) {
            ridePrice = (rideType === 'ROUND-TRIP' || rideType === 'Round-Trip')
                ? (ambDoc.pricing?.doubleRidePrice || 700)
                : (ambDoc.pricing?.singleRidePrice || 400);
        } else {
            ridePrice = Number(ambulance.ridePrice || 400);
        }

        // On-Board Staff Addons
        let nurseFee = 0;
        let onBoardDocFee = 0;

        if (ambulance.supportStaff?.nurse?.selected) {
            nurseFee = Number(ambulance.supportStaff?.nurse?.price || 300);
        }
        if (ambulance.supportStaff?.doctor?.selected) {
            onBoardDocFee = Number(ambulance.supportStaff?.doctor?.price || 700);
        }

        ambulanceFee = ridePrice + nurseFee + onBoardDocFee;

        verifiedAmbulance = {
            ambulanceId: ambulance.ambulanceId,
            vehicleNumber: ambulance.vehicleNumber || ambDoc?.vehicleNumber || "PB65AB1234",
            vehicleType: ambulance.vehicleType || ambDoc?.vehicleType || "Advance Life Support",
            driverName: ambulance.driverName || ambDoc?.name || "Rajesh Kumar",
            phone: ambulance.phone || ambDoc?.phone || "",
            rideType,
            ridePrice,
            supportStaff: {
                nurse: {
                    selected: Boolean(ambulance.supportStaff?.nurse?.selected),
                    price: nurseFee
                },
                doctor: {
                    selected: Boolean(ambulance.supportStaff?.doctor?.selected),
                    price: onBoardDocFee
                }
            },
            totalAmbulancePrice: ambulanceFee
        };
    }

    // 5. Calculate Subtotal
    const subtotal = doctorFee + bedFee + ambulanceFee;

    // 6. Coupon Discount Verification
    let couponDiscount = 0;
    let validCouponId = null;

    if (couponCode) {
        const cleanCode = String(couponCode).toUpperCase().trim();
        const now = new Date();

        const coupon = await Coupon.findOne({
            couponName: cleanCode,
            isActive: true,
            startDate: { $lte: now },
            expiryDate: { $gte: now },
            vendorType: { $in: ['Doctor', 'Clinic', 'All'] }
        });

        if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
            couponDiscount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            validCouponId = coupon._id;
        }
    }

    const finalAmount = Math.max(0, subtotal - couponDiscount);

    // 7. COD Availability Check
    const codSetting = await CodConfig.findOne({ vendorType: { $in: ['Clinic', 'Doctor', 'All'] } });
    const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

    return {
        clinic,
        verifiedDoctor,
        verifiedWard,
        verifiedAmbulance,
        pricingBreakdown: {
            doctorFee,
            bedFee,
            ambulanceFee,
            subtotal,
            discountAmount: Math.round(couponDiscount),
            couponId: validCouponId,
            totalPrice: Math.round(finalAmount)
        },
        orderRestrictions: {
            isCodAvailable
        }
    };
};


// ==========================================
// 🧮 1. CALCULATE / PREVIEW CLINIC BILL (POST /calculate)
// ==========================================
const calculateClinicBill = async (req, res) => {
    try {
        const body = req.body || {};
        const clinicId = body.clinicId;
        const bookingType = body.bookingType || 'OPD';
        const doctor = parseField(body.doctor);
        const ward = parseField(body.ward);
        const ambulance = parseField(body.ambulance);
        const couponCode = body.couponCode;

        if (!clinicId) {
            return res.status(400).json({
                success: false,
                message: "Clinic ID (clinicId) is required."
            });
        }

        const calculation = await calculateClinicBillHelper({
            clinicId,
            bookingType,
            doctor: doctor || {},
            ward: ward || null,
            ambulance: ambulance || null,
            couponCode
        });

        res.json({
            success: true,
            bookingType,
            clinic: calculation.clinic,
            doctor: calculation.verifiedDoctor,
            ward: calculation.verifiedWard,
            ambulance: calculation.verifiedAmbulance,
            pricingBreakdown: calculation.pricingBreakdown,
            orderRestrictions: calculation.orderRestrictions
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🏥 2. PLACE CLINIC BOOKING (POST /book - Generates OPD Token for COD/Free Bookings)
// ==========================================
const bookClinicOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        const clinicId = body.clinicId;
        const bookingType = body.bookingType || 'OPD';
        const patient = parseField(body.patient);
        const doctor = parseField(body.doctor);
        const ward = parseField(body.ward);
        const ambulance = parseField(body.ambulance);
        const address = parseField(body.address);
        const homeVisitDetails = parseField(body.homeVisitDetails);
        const consultationType = body.consultationType || 'Clinic Visit';
        const appointmentDate = body.appointmentDate;
        const appointmentTime = body.appointmentTime;
        const symptoms = body.symptoms || "";
        const couponCode = body.couponCode;
        const paymentMethod = body.paymentMethod || 'Online';

        if (!clinicId) {
            return res.status(400).json({ 
                success: false, 
                message: "Clinic ID (clinicId) is required." 
            });
        }

        let uploadedFileUrl = null;
        if (req.files) {
            const file = req.files['medicalDocument']?.[0] || req.files['prescription']?.[0] || req.files['file']?.[0];
            if (file) {
                uploadedFileUrl = `/uploads/clinics/${file.filename}`;
            }
        } else if (req.file) {
            uploadedFileUrl = `/uploads/clinics/${req.file.filename}`;
        }

        const selectedMode = doctor?.mode || consultationType;
        const isHomeVisit = selectedMode === 'Home Visit' || selectedMode === 'homeVisitFee' || selectedMode === 'home';
        
        if (isHomeVisit && (!address || !address.phone || !address.city || !address.houseNo)) {
            return res.status(400).json({ 
                success: false, 
                message: "Complete address with phone, house number, and city is mandatory for Doctor Home Visits." 
            });
        }

        const calculation = await calculateClinicBillHelper({
            clinicId,
            bookingType,
            doctor: doctor || {},
            ward: ward || null,
            ambulance: ambulance || null,
            couponCode
        });

        if (paymentMethod === 'COD' && calculation.orderRestrictions.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled for clinic bookings. Please proceed with Online Payment."
            });
        }

        const targetWardId = calculation.verifiedWard?.wardId || ward?.wardId || null;
        const targetBedId = calculation.verifiedWard?.bedId || ward?.bedId || null;
        const targetAmbulanceId = calculation.verifiedAmbulance?.ambulanceId || ambulance?.ambulanceId || null;

        if (targetBedId) {
            const existingBed = await Bed.findById(targetBedId);
            if (!existingBed) {
                return res.status(404).json({ success: false, message: "Selected bed unit not found." });
            }
            if (existingBed.status === 'Occupied' || existingBed.status === 'Maintenance') {
                return res.status(400).json({ success: false, message: "Selected bed is already occupied or under maintenance." });
            }
        }

        const totalPayable = calculation.pricingBreakdown.totalPrice;
        const tempBookingId = `DI-ORD-${Math.floor(100000 + Math.random() * 900000)}`;

        let rzpOrder = null;
        if (paymentMethod !== 'COD' && totalPayable > 0) {
            rzpOrder = await createRazorpayOrder(totalPayable, `cln_${tempBookingId}_${Date.now()}`);
        }

        const userSelectedDoctorId = doctor?.doctorId || doctor?._id || calculation.verifiedDoctor?._id || null;

        const newAppointment = await Appointment.create({
            bookingId: tempBookingId,
            userId,
            clinicId,
            doctorId: userSelectedDoctorId,
            isDoctorSelectedAlready: Boolean(userSelectedDoctorId),

            wardId: targetWardId,
            bedId: targetBedId,
            ambulanceId: targetAmbulanceId,

            bookingType: bookingType === 'IPD' ? 'Admission' : (bookingType === 'EMERGENCY' ? 'Emergency' : 'Appointment'),
            bedBookingType: bookingType === 'EMERGENCY' ? 'Emergency-Bed' : 'General-Bed',
            bookingReason: symptoms || homeVisitDetails?.reason || "",
            consultationType: isHomeVisit ? 'Home Visit' : (selectedMode === 'video' || selectedMode === 'Video Consult' || selectedMode === 'videoConsultFee' ? 'Video Consult' : 'Clinic Visit'),
            appointmentDate: appointmentDate ? new Date(appointmentDate) : (ward?.startDate ? new Date(ward.startDate) : new Date()),
            appointmentTime: appointmentTime || homeVisitDetails?.preferredTime || "10:30 AM",
            
            patients: [{
                patientName: patient?.memberName || req.user?.name || "Myself (Primary Account)",
                patientAge: Number(patient?.age) || 30,
                gender: patient?.gender || 'Male',
                relation: patient?.relation || (patient?.isSelf ? 'SELF' : 'Family Member'),
                reasonForVisit: symptoms || homeVisitDetails?.reason || "",
                isMainUser: Boolean(patient?.isSelf)
            }],

            address: address ? {
                name: address.name || patient?.memberName,
                phone: address.phone || patient?.phone,
                houseNo: address.houseNo || "",
                sector: address.sector || "",
                landmark: address.landmark || "",
                city: address.city || "",
                state: address.state || "",
                pincode: address.pincode || "",
                addressType: address.addressType || "Home"
            } : { addressType: "Home" },

            pricingBreakdown: {
                baseFee: calculation.pricingBreakdown.doctorFee,
                visitCharges: calculation.pricingBreakdown.bedFee,
                extraCharges: calculation.pricingBreakdown.ambulanceFee,
                discountAmount: calculation.pricingBreakdown.discountAmount,
                subtotal: calculation.pricingBreakdown.subtotal,
                originalBaseFee: 0,
                cancellationFeeApplied: 0,
                noShowFeeApplied: 0
            },
            totalAmount: totalPayable,

            wardName: calculation.verifiedWard?.wardName || ward?.wardName || "",
            bedNumber: calculation.verifiedWard?.bedNumber || ward?.bedNumber || "",
            stayDuration: calculation.verifiedWard?.totalDays || ward?.totalDays || 0,
            startDate: calculation.verifiedWard?.startDate ? new Date(calculation.verifiedWard.startDate) : (ward?.startDate ? new Date(ward.startDate) : null),
            endDate: calculation.verifiedWard?.endDate ? new Date(calculation.verifiedWard.endDate) : (ward?.endDate ? new Date(ward.endDate) : null),

            clinicalSummary: {
                chiefComplaint: symptoms || "",
                uploadedReports: uploadedFileUrl ? [uploadedFileUrl] : []
            },

            couponDetails: calculation.pricingBreakdown.couponId ? {
                couponId: calculation.pricingBreakdown.couponId,
                couponCode: couponCode,
                discountValue: calculation.pricingBreakdown.discountAmount
            } : undefined,

            status: paymentMethod === 'COD' || totalPayable === 0 ? 'Confirmed' : 'Pending',
            paymentMethod,
            paymentStatus: 'Pending',
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        if (targetBedId && (paymentMethod === 'COD' || totalPayable === 0)) {
            await Bed.findByIdAndUpdate(targetBedId, {
                status: 'Occupied',
                currentAppointmentId: newAppointment._id
            });
            if (targetWardId) {
                await Ward.findByIdAndUpdate(targetWardId, {
                    $inc: { availableBeds: -1 }
                });
            }
        } else if (targetBedId) {
            await Bed.findByIdAndUpdate(targetBedId, {
                status: 'Reserved',
                currentAppointmentId: newAppointment._id
            });
        }

        // Generate OPD Token immediately for Confirmed (COD / Free) bookings when doctor is selected
        let tokenDetails = null;
        if ((paymentMethod === 'COD' || totalPayable === 0) && newAppointment.bookingType === 'Appointment' && newAppointment.doctorId) {
            await assignOpdTokenToAppointment(newAppointment);
            tokenDetails = await getOpdTokenQueueStatus(newAppointment);
        }

        if (paymentMethod === 'COD' || totalPayable === 0) {
            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: tokenDetails?.formattedToken
                    ? `Clinic booking confirmed! Your OPD Token is #${tokenDetails.formattedToken}.`
                    : "Clinic booking confirmed successfully (COD)!",
                tokenDetails,
                data: newAppointment
            });
        }

        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: "Razorpay payment order generated for clinic booking.",
            key: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: totalPayable,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: newAppointment.bookingId,
            appointmentId: newAppointment._id,
            data: newAppointment
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 3. VERIFY RAZORPAY PAYMENT (Generates OPD Token after Payment Confirmation)
// ==========================================
const verifyClinicPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            appointmentId, 
            bookingId, 
            razorpayOrderId, 
            razorpayPaymentId, 
            razorpaySignature 
        } = req.body;

        const targetId = appointmentId || bookingId;

        if (!targetId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing payment verification parameters." });
        }

        let isVerified = false;
        try {
            isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        } catch (e) {
            const secret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/["']/g, "").trim();
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(`${razorpayOrderId}|${razorpayPaymentId}`)
                .digest('hex');
            isVerified = (expectedSignature === razorpaySignature);
        }

        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Cryptographic payment verification failed." });
        }

        const booking = await Appointment.findOne({
            $or: [
                { _id: targetId },
                { bookingId: targetId },
                { "paymentDetails.razorpayOrderId": razorpayOrderId }
            ],
            userId
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Clinic booking record not found." });
        }

        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.status = 'Confirmed';
        booking.paymentDetails = {
            razorpayPaymentId,
            razorpayOrderId,
            razorpaySignature,
            paidAt: new Date()
        };

        if (booking.bedId) {
            const bed = await Bed.findByIdAndUpdate(
                booking.bedId,
                { status: 'Occupied', currentAppointmentId: booking._id },
                { new: false }
            );
            if (bed && bed.status !== 'Occupied' && booking.wardId) {
                await Ward.findByIdAndUpdate(booking.wardId, { $inc: { availableBeds: -1 } });
            }
        }

        await booking.save();

        // Generate OPD Token on Payment Confirmation if OPD + Doctor selected
        let tokenDetails = null;
        if (booking.bookingType === 'Appointment' && booking.doctorId) {
            await assignOpdTokenToAppointment(booking);
            tokenDetails = await getOpdTokenQueueStatus(booking);
        }

        res.json({
            success: true,
            message: tokenDetails?.formattedToken
                ? `Payment verified & clinic booking confirmed! Your OPD Token is #${tokenDetails.formattedToken}.`
                : "Payment verified successfully & clinic booking confirmed!",
            tokenDetails,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 4. GET MY CLINIC BOOKINGS (Includes Token & Live Wait Status for OPD)
// ==========================================
const getMyClinicBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, bookingType } = req.query;

        const query = { userId };
        if (status) query.status = status;
        if (bookingType) query.bookingType = bookingType;

        const bookings = await Appointment.find(query)
            .select('_id bookingId bookingType consultationType status paymentStatus totalAmount appointmentDate appointmentTime wardName bedNumber startDate endDate clinicId doctorId tokenNumber formattedToken tokenIntervalMinutes opdRoomNumber createdAt')
            .populate('clinicId', 'name clinicName city image')
            .populate('doctorId', 'name speciality profileImage cabinNumber')
            .sort({ createdAt: -1 })
            .lean();

        const cleanList = await Promise.all(
            bookings.map(async (b) => {
                const dateVal = b.appointmentDate || b.startDate;
                let tokenQueueStatus = null;
                if (b.bookingType === 'Appointment' && b.tokenNumber) {
                    tokenQueueStatus = await getOpdTokenQueueStatus({
                        ...b,
                        clinicId: b.clinicId?._id || b.clinicId,
                        doctorId: b.doctorId?._id || b.doctorId
                    });
                }

                return {
                    _id: b._id,
                    bookingId: b.bookingId,
                    bookingType: b.bookingType,
                    consultationType: b.consultationType,
                    status: b.status,
                    paymentStatus: b.paymentStatus,
                    totalAmount: b.totalAmount || 0,
                    appointmentDate: dateVal ? new Date(dateVal).toISOString().split('T')[0] : null,
                    appointmentTime: b.appointmentTime || "10:30 AM",
                    tokenNumber: b.tokenNumber || null,
                    formattedToken: b.formattedToken || "",
                    opdRoomNumber: b.opdRoomNumber || b.doctorId?.cabinNumber || "",
                    tokenQueueStatus,
                    wardInfo: b.wardName ? `${b.wardName} (Bed #${b.bedNumber})` : null,
                    clinic: {
                        _id: b.clinicId?._id,
                        name: b.clinicId?.clinicName || b.clinicId?.name || "Clinic Facility",
                        city: b.clinicId?.city || "Mohali",
                        image: b.clinicId?.image || null
                    },
                    doctor: {
                        _id: b.doctorId?._id,
                        name: b.doctorId?.name || "Attending Specialist",
                        speciality: b.doctorId?.speciality || "General Physician",
                        profileImage: b.doctorId?.profileImage || null
                    },
                    createdAt: b.createdAt
                };
            })
        );

        res.json({
            success: true,
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 5. GET SINGLE CLINIC BOOKING FULL DETAILS (With Live Token Queue Status)
// ==========================================
const getSingleClinicBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const idQuery = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }] }
            : { bookingId: id };

        const booking = await Appointment.findOne({
            ...idQuery,
            userId
        })
        .populate('clinicId', 'name clinicName city state address phoneNumber image posterimage')
        .populate('doctorId', 'name speciality qualification experienceYears languages fees profileImage cabinNumber')
        .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverName pricing')
        .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Clinic booking not found." });
        }

        let tokenQueueStatus = null;
        if (booking.bookingType === 'Appointment') {
            tokenQueueStatus = await getOpdTokenQueueStatus({
                ...booking,
                clinicId: booking.clinicId?._id || booking.clinicId,
                doctorId: booking.doctorId?._id || booking.doctorId
            });
        }

        res.json({
            success: true,
            data: {
                ...booking,
                tokenQueueStatus
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🎫 6. USER LIVE OPD TOKEN & QUEUE TRACKER
// @route   GET /api/clinic/checkout/token-status/:id
// ==========================================
const getMyOpdTokenLiveStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const idQuery = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }] }
            : { bookingId: id };

        const booking = await Appointment.findOne({ ...idQuery, userId })
            .populate('doctorId', 'name speciality profileImage cabinNumber')
            .populate('clinicId', 'name clinicName city address')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        if (booking.bookingType !== 'Appointment') {
            return res.status(400).json({
                success: false,
                message: "Token queue tracking is only applicable to OPD appointments."
            });
        }

        const tokenQueueStatus = await getOpdTokenQueueStatus({
            ...booking,
            clinicId: booking.clinicId?._id || booking.clinicId,
            doctorId: booking.doctorId?._id || booking.doctorId
        });

        res.status(200).json({
            success: true,
            bookingId: booking.bookingId,
            doctor: booking.doctorId || null,
            clinic: booking.clinicId || null,
            data: tokenQueueStatus
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateClinicBill,
    bookClinicOrder,
    verifyClinicPayment,
    getMyClinicBookings,
    getSingleClinicBooking,
    getMyOpdTokenLiveStatus
};