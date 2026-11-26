// controllers/clinic/clinicAppointments.js

const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const Clinic = require('../../models/Clinic');
const Ambulance = require('../../models/Ambulance');
const Bed = require('../../models/Bed');
const Ward = require('../../models/Ward');
const User = require('../../models/User');
const ReferredToAnotherDoctor = require('../../models/ReferredToAnotherDoctor');
const Prescription = require('../../models/Prescription');
const {  syncClinicWardAndBedCapacity } = require('../../utils/opdTokenHelper');
const { sendPushNotification } = require('../../utils/notification');
const crypto = require('crypto');
const moment = require('moment');
const { assignOpdTokenToAppointment, getOpdTokenQueueStatus } = require('../../utils/opdTokenHelper');
// Safe JSON parser for FormData
const parseField = (val) => {
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
};

// ==========================================
// 🏥 1. CREATE CLINIC APPOINTMENT / ADMISSION (Generates OPD Token if OPD + Doctor Selected)
// ==========================================
const createClinicAppointmentByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const body = req.body || {};

        const patient = parseField(body.patient);
        const address = parseField(body.address);

        const rawPhone = body.phone || patient?.phone || address?.phone || "";
        const patientPhone = rawPhone.toString().trim();
        const countryCode = (body.countryCode || patient?.countryCode || "+91").trim();
        const patientName = body.name || patient?.name || patient?.patientName || "Patient";
        const patientAge = Number(body.age || patient?.age || patient?.patientAge) || 30;
        const patientGender = body.gender || patient?.gender || 'Male';
        const relation = (body.relation || patient?.relation || 'Self').trim();

        if (!patientPhone || patientPhone === '') {
            return res.status(400).json({
                success: false,
                message: "Patient contact phone number is mandatory."
            });
        }

        let user = await User.findOne({ 
            $or: [
                { phone: patientPhone },
                { phone: patientPhone, countryCode }
            ]
        });
        
        if (!user) {
            user = await User.create({
                name: relation.toLowerCase() === 'self' ? patientName : (address?.name || patientName),
                phone: patientPhone,
                countryCode: countryCode,
                password: null,
                isUserRegistered: true,
                isPasswordAvailable: false,
                profileStatus: 'Incomplete',
                role: 'user',
                userAddress: [],
                familyMember: []
            });
        }

        const isSelfBooking = relation.toLowerCase() === 'self' || 
                              patientName.toLowerCase().includes('myself') || 
                              patientName.toLowerCase() === 'self';
        
        let resolvedPatientName = patientName;
        if (isSelfBooking) {
            if (user?.name && !user.name.toLowerCase().includes('myself') && user.name.toLowerCase() !== 'self') {
                resolvedPatientName = user.name;
            } else if (address?.name) {
                resolvedPatientName = address.name;
            }
        }

        if (!isSelfBooking) {
            const memberExists = user.familyMember && user.familyMember.some(
                m => m.memberName?.toLowerCase() === patientName.toLowerCase() && m.relation?.toLowerCase() === relation.toLowerCase()
            );

            if (!memberExists) {
                user.familyMember.push({
                    memberName: patientName,
                    relation: relation,
                    gender: patientGender,
                    phone: patientPhone,
                    hasInsurance: false
                });
                await user.save();
            }
        }

        const bookingType = body.bookingType || 'Appointment';
        const consultationType = body.consultationType || 'Clinic Visit';
        const doctorId = body.doctorId || null;
        const ambulanceId = body.ambulanceId || null;
        const targetWardId = body.wardId || null;
        const targetBedId = body.bedId || null;

        const appointmentDate = body.appointmentDate ? new Date(body.appointmentDate) : new Date();
        const appointmentTime = body.appointmentTime || "10:30 AM";
        const symptoms = body.symptoms || body.bookingReason || "";
        const paymentMethod = body.paymentMethod || 'COD';

        let verifiedDoctor = null;
        let doctorFee = 0;
        if (doctorId) {
            verifiedDoctor = await Doctor.findOne({ _id: doctorId, clinicId });
            if (verifiedDoctor) {
                doctorFee = Number(verifiedDoctor.fees?.clinic || 500);
            }
        }

        let verifiedAmbulance = null;
        let ambulanceFee = 0;
        if (ambulanceId) {
            verifiedAmbulance = await Ambulance.findOne({ _id: ambulanceId, clinicId });
            if (verifiedAmbulance) {
                ambulanceFee = Number(verifiedAmbulance.pricing?.singleRidePrice || 400);
            }
        }

        let verifiedBed = null;
        let verifiedWard = null;
        let bedFee = 0;
        let totalDays = Number(body.stayDuration || body.totalDays || 1);

        if (targetBedId) {
            verifiedBed = await Bed.findOne({ _id: targetBedId, clinicId });
            if (!verifiedBed) {
                return res.status(404).json({ success: false, message: "Selected Bed unit not found in your clinic." });
            }
            if (verifiedBed.status === 'Occupied' || verifiedBed.status === 'Maintenance') {
                return res.status(400).json({ success: false, message: `Bed ${verifiedBed.bedNumber} is already occupied or in maintenance.` });
            }

            if (targetWardId || verifiedBed.wardId) {
                verifiedWard = await Ward.findById(targetWardId || verifiedBed.wardId);
            }

            const perDayPrice = Number(verifiedBed.pricePerDay || verifiedWard?.pricePerDay || 600);
            bedFee = perDayPrice * totalDays;
        }

        const subtotal = Number(body.totalAmount) || (doctorFee + bedFee + ambulanceFee);
        const tempBookingId = `CLN-ADM-${Math.floor(100000 + Math.random() * 900000)}`;

        const newAppointment = await Appointment.create({
            bookingId: tempBookingId,
            userId: user._id,
            clinicId,
            doctorId: verifiedDoctor ? verifiedDoctor._id : (doctorId || null),
            ambulanceId: verifiedAmbulance ? verifiedAmbulance._id : (ambulanceId || null),
            wardId: verifiedWard ? verifiedWard._id : (targetWardId || null),
            bedId: verifiedBed ? verifiedBed._id : (targetBedId || null),

            bookingType: bookingType === 'IPD' || bookingType === 'Admission' ? 'Admission' : (bookingType === 'Emergency' ? 'Emergency' : 'Appointment'),
            bedBookingType: bookingType === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
            bookingReason: symptoms,
            consultationType,
            appointmentDate,
            appointmentTime,

            patients: [{
                patientName: resolvedPatientName,
                patientAge: patientAge,
                gender: patientGender,
                relation: isSelfBooking ? 'Self' : relation,
                reasonForVisit: symptoms,
                isMainUser: isSelfBooking
            }],

            address: address ? {
                name: address.name || resolvedPatientName,
                phone: patientPhone,
                houseNo: address.houseNo || "",
                sector: address.sector || "",
                landmark: address.landmark || "",
                city: address.city || "",
                state: address.state || "",
                pincode: address.pincode || "",
                addressType: address.addressType || "Home"
            } : {
                name: resolvedPatientName,
                phone: patientPhone,
                addressType: "Home"
            },

            pricingBreakdown: {
                baseFee: doctorFee,
                visitCharges: bedFee,
                extraCharges: ambulanceFee,
                discountAmount: 0,
                subtotal: subtotal,
                originalBaseFee: doctorFee,
                cancellationFeeApplied: 0,
                noShowFeeApplied: 0
            },
            totalAmount: subtotal,

            wardName: verifiedWard ? verifiedWard.name : (body.wardName || ""),
            bedNumber: verifiedBed ? verifiedBed.bedNumber : (body.bedNumber || ""),
            stayDuration: totalDays,
            startDate: body.startDate ? new Date(body.startDate) : appointmentDate,
            endDate: body.endDate ? new Date(body.endDate) : (targetBedId ? new Date(Date.now() + totalDays * 86400000) : null),

            clinicalSummary: {
                chiefComplaint: symptoms,
                uploadedReports: []
            },

            status: 'Confirmed',
            paymentMethod,
            paymentStatus: paymentMethod === 'COD' ? 'Pending' : 'Paid'
        });

        if (targetBedId) {
            await Bed.findByIdAndUpdate(targetBedId, {
                status: 'Occupied',
                currentAppointmentId: newAppointment._id
            });

            const wardToUpdate = targetWardId || verifiedBed.wardId;
            if (wardToUpdate) {
                await Ward.findByIdAndUpdate(wardToUpdate, {
                    $inc: { availableBeds: -1 }
                });
            }
        }

        // Generate OPD Token if OPD & Doctor selected
        if (newAppointment.bookingType === 'Appointment' && newAppointment.doctorId) {
            await assignOpdTokenToAppointment(newAppointment);
        }

        res.status(201).json({
            success: true,
            message: newAppointment.formattedToken
                ? `Clinic booking created! OPD Token #${newAppointment.formattedToken} generated.`
                : "Clinic booking created successfully! Bed marked Occupied & linked to user account.",
            data: {
                _id: newAppointment._id,
                bookingId: newAppointment.bookingId,
                bookingType: newAppointment.bookingType,
                status: newAppointment.status,
                tokenNumber: newAppointment.tokenNumber || null,
                formattedToken: newAppointment.formattedToken || "",
                patientName: newAppointment.patients?.[0]?.patientName,
                relation: newAppointment.patients?.[0]?.relation,
                userProfileStatus: user.profileStatus,
                isUserRegistered: user.isUserRegistered,
                isPasswordAvailable: user.isPasswordAvailable,
                wardName: newAppointment.wardName,
                bedNumber: newAppointment.bedNumber,
                totalAmount: newAppointment.totalAmount,
                paymentMethod: newAppointment.paymentMethod,
                createdAt: newAppointment.createdAt
            }
        });

    } catch (error) {
        console.error("Create Clinic Appointment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 2. GET ALL CLINIC BOOKINGS (Includes Token Number)
// ==========================================
const getClinicBookings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { 
            status, 
            bookingType, 
            type, 
            search, 
            date,
            page = 1, 
            limit = 20 
        } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;
        const skip = (pageNum - 1) * limitNum;

        const query = { clinicId };

        if (status) {
            query.status = status;
        }

        const targetType = (bookingType || type || '').trim();
        if (targetType) {
            const normalized = targetType.toUpperCase();
            if (normalized === 'OPD' || normalized === 'APPOINTMENT') {
                query.bookingType = 'Appointment';
            } else if (normalized === 'IPD' || normalized === 'ADMISSION') {
                query.bookingType = 'Admission';
            } else if (normalized === 'EMERGENCY') {
                query.bookingType = 'Emergency';
            } else {
                query.bookingType = targetType;
            }
        }

        const andConditions = [];

        if (date !== 'all') {
            const filterMoment = (date && date.trim() !== '') ? moment(date) : moment();
            const startOfDay = filterMoment.clone().startOf('day').toDate();
            const endOfDay = filterMoment.clone().endOf('day').toDate();

            andConditions.push({
                $or: [
                    { appointmentDate: { $gte: startOfDay, $lte: endOfDay } },
                    { 
                        bookingType: { $in: ['Admission', 'Emergency'] },
                        startDate: { $lte: endOfDay },
                        endDate: { $gte: startOfDay }
                    }
                ]
            });
        }

        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            andConditions.push({
                $or: [
                    { bookingId: searchRegex },
                    { "patients.patientName": searchRegex },
                    { "address.name": searchRegex },
                    { "address.phone": searchRegex }
                ]
            });
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        const totalDocs = await Appointment.countDocuments(query);

        const bookings = await Appointment.find(query)
            .select('_id bookingId bookingType consultationType status paymentStatus totalAmount appointmentDate appointmentTime wardName bedNumber startDate endDate clinicId doctorId isDoctorSelectedAlready tokenNumber formattedToken opdRoomNumber patients address createdAt')
            .populate('clinicId', 'name clinicName city image')
            .populate('doctorId', 'name speciality profileImage')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const cleanList = bookings.map(b => {
            const dateVal = b.appointmentDate || b.startDate;
            const primaryPatient = Array.isArray(b.patients) && b.patients.length > 0 ? b.patients[0] : null;

            let resolvedName = primaryPatient?.patientName || b.address?.name || b.userId?.name || "Patient";
            const lowerName = resolvedName.toLowerCase();
            const lowerRel = (primaryPatient?.relation || "").toLowerCase();

            if ((lowerName.includes("myself") || lowerName === "self" || lowerRel === "self") && b.userId?.name) {
                resolvedName = b.userId.name;
            }

            return {
                _id: b._id,
                bookingId: b.bookingId,
                bookingType: b.bookingType,
                categoryTag: b.bookingType === 'Admission' ? 'IPD' : (b.bookingType === 'Emergency' ? 'EMERGENCY' : 'OPD'),
                consultationType: b.consultationType || 'Clinic Visit',
                status: b.status,
                paymentStatus: b.paymentStatus,
                totalAmount: b.totalAmount || 0,
                appointmentDate: dateVal ? new Date(dateVal).toISOString().split('T')[0] : null,
                appointmentTime: b.appointmentTime || "10:30 AM",
                tokenNumber: b.tokenNumber || null,
                formattedToken: b.formattedToken || "",
                opdRoomNumber: b.opdRoomNumber || "",
                patientName: resolvedName,
                patientAge: primaryPatient?.patientAge || null,
                patientGender: primaryPatient?.gender || null,
                wardInfo: b.wardName ? `${b.wardName} (Bed #${b.bedNumber})` : null,
                isDoctorSelectedAlready: Boolean(b.isDoctorSelectedAlready),
                doctor: {
                    _id: b.doctorId?._id,
                    name: b.doctorId?.name || "Attending Specialist",
                    speciality: b.doctorId?.speciality || "Specialist",
                    profileImage: b.doctorId?.profileImage || null
                },
                createdAt: b.createdAt
            };
        });

        res.json({
            success: true,
            filterApplied: date === 'all' ? 'All Dates' : (date ? moment(date).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD') + ' (Today)'),
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🔍 3. GET SINGLE CLINIC BOOKING FULL DETAILS
// Full Path: GET /api/clinic/booking/booking/:bookingId
// ==========================================
const getSingleClinicBookingDetails = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const targetId = req.params.bookingId || req.params.id;

        const booking = await Appointment.findOne({
            $or: [{ _id: targetId }, { bookingId: targetId }],
            clinicId
        })
        .populate('clinicId', 'name clinicName city state address phoneNumber image posterimage')
        .populate('doctorId', 'name speciality qualification experienceYears languages fees profileImage')
        .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverName pricing')
        .populate('userId', 'name email phone gender dob profilePic')
        .populate('wardId', 'name type pricePerDay')
        .populate('bedId', 'bedNumber status pricePerDay')
        .lean();

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Booking record not found or not assigned to your clinic facility." 
            });
        }

        // 🎯 FIX: Single view me bhi patients array me real name resolve karein
        if (booking.patients && Array.isArray(booking.patients) && booking.patients.length > 0) {
            booking.patients = booking.patients.map(p => {
                const pName = (p.patientName || "").toLowerCase();
                const pRel = (p.relation || "").toLowerCase();
                if ((pName.includes("myself") || pName === "self" || pRel === "self") && booking.userId?.name) {
                    return { ...p, patientName: booking.userId.name };
                }
                return p;
            });
        }

        res.json({
            success: true,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 📋 GET ALL CLINIC CREATED BOOKINGS (Simple List - No Pagination)
// Full Path: GET /api/clinic/booking/direct-bookings
// ==========================================
const getClinicDirectBookings = async (req, res) => {
    try {
        const clinicId = req.user.id; // Logged-in clinic ID

        // Fetch all bookings for this clinic with complete population
        const bookings = await Appointment.find({ clinicId })
            .populate('clinicId', 'name clinicName city state address phoneNumber image')
            .populate('doctorId', 'name speciality qualification fees profileImage experienceYears')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverName pricing supportStaff')
            .populate('wardId', 'name type pricePerDay')
            .populate('bedId', 'bedNumber status pricePerDay')
            .populate('userId', 'name phone email')
            .sort({ createdAt: -1 })
            .lean();

        // Clean & formatted response with full details and price breakdown
        const formattedData = bookings.map(b => {
            const primaryPatient = Array.isArray(b.patients) && b.patients.length > 0 ? b.patients[0] : null;

            return {
                _id: b._id,
                bookingId: b.bookingId,
                bookingType: b.bookingType,                       // 'Appointment' | 'Admission' | 'Emergency'
                consultationType: b.consultationType || 'Clinic Visit',
                status: b.status,
                paymentStatus: b.paymentStatus,
                paymentMethod: b.paymentMethod,
                appointmentDate: b.appointmentDate ? new Date(b.appointmentDate).toISOString().split('T')[0] : null,
                appointmentTime: b.appointmentTime || "10:30 AM",
                isDoctorSelectedAlready: Boolean(b.isDoctorSelectedAlready),

                // 🏨 Ward & Bed Stay Information
                stayDetails: {
                    wardName: b.wardName || b.wardId?.name || null,
                    bedNumber: b.bedNumber || b.bedId?.bedNumber || null,
                    stayDuration: b.stayDuration || 0,
                    startDate: b.startDate ? new Date(b.startDate).toISOString().split('T')[0] : null,
                    endDate: b.endDate ? new Date(b.endDate).toISOString().split('T')[0] : null
                },

                // 💰 Proper Price Breakdown
                pricingDetails: {
                    doctorFee: b.pricingBreakdown?.baseFee || 0,
                    bedFee: b.pricingBreakdown?.visitCharges || 0,
                    ambulanceFee: b.pricingBreakdown?.extraCharges || 0,
                    discountAmount: b.pricingBreakdown?.discountAmount || 0,
                    subtotal: b.pricingBreakdown?.subtotal || b.totalAmount || 0,
                    totalAmount: b.totalAmount || 0
                },

                // 👤 Patient & Address Details
                patient: primaryPatient ? {
                    name: primaryPatient.patientName,
                    age: primaryPatient.patientAge,
                    gender: primaryPatient.gender,
                    relation: primaryPatient.relation,
                    reasonForVisit: primaryPatient.reasonForVisit || b.bookingReason
                } : null,
                address: b.address || null,

                // 🏥 Populated Entities
                clinic: b.clinicId || null,
                doctor: b.doctorId || null,
                ambulance: b.ambulanceId || null,
                ward: b.wardId || null,
                bed: b.bedId || null,

                createdAt: b.createdAt
            };
        });

        res.json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🏥 GET CLINIC BOOKING RESOURCES (Doctors, Ambulances, Wards & Beds Dropdown)
// Full Path: GET /api/clinic/booking/resources
// ==========================================
const getClinicBookingResources = async (req, res) => {
    try {
        const clinicId = req.user.id; // Logged-in clinic ID

        // 1. Fetch all doctors belonging to this clinic
        const doctors = await Doctor.find({ clinicId })
            .select('_id name speciality qualification fees profileImage averageRating dutyStatus')
            .lean();

        // 2. Fetch all ambulances assigned to this clinic
        const ambulances = await Ambulance.find({ clinicId })
            .select('_id name vehicleNumber vehicleType phone driverName pricing supportStaff isOnline availableForEmergency')
            .lean();

        // 3. Fetch all active wards & all bed units of this clinic
        const wards = await Ward.find({ clinicId, isActive: true }).lean();
        const beds = await Bed.find({ clinicId }).lean();

        // 4. Map beds inside their respective wards with real-time status & pricing
        const wardsWithBeds = wards.map(ward => {
            const wardBeds = beds.filter(bed => bed.wardId?.toString() === ward._id.toString());
            const availableCount = wardBeds.filter(bed => bed.status === 'Available').length;

            return {
                _id: ward._id,
                name: ward.name,
                type: ward.type,
                pricePerDay: ward.pricePerDay || 0,
                totalBedsCount: wardBeds.length || ward.totalBeds || 0,
                availableBedsCount: availableCount,
                beds: wardBeds.map(b => ({
                    _id: b._id,
                    bedNumber: b.bedNumber,
                    status: b.status, // 'Available', 'Occupied', 'Maintenance', 'Reserved'
                    isAvailable: b.status === 'Available',
                    pricePerDay: b.pricePerDay || ward.pricePerDay || 0
                }))
            };
        });

        res.json({
            success: true,
            data: {
                doctors,
                ambulances,
                wards: wardsWithBeds
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔁 6. CLINIC GETS ONLY REFERRED CASES LIST (Sent by Clinic Doctors)
// @route   GET /api/clinic/booking/referred-cases?status=Pending-Clinic-Booking
// ==========================================
const getClinicReferredCases = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { status, search, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (pageNum - 1) * limitNum;

        const query = { clinicId };
        if (status && String(status).trim() !== '') {
            query.status = String(status).trim();
        }

        if (search && String(search).trim() !== '') {
            const regex = new RegExp(String(search).trim(), 'i');
            query.$or = [
                { referralCode: regex },
                { reason: regex }
            ];
        }

        const [totalDocs, referrals, pendingCount, bookedCount] = await Promise.all([
            ReferredToAnotherDoctor.countDocuments(query),
            ReferredToAnotherDoctor.find(query)
                .populate('userId', 'name phone email gender age profilePic')
                .populate('referredByDoctorId', 'name speciality cabinNumber profileImage')
                .populate('referredToDoctorId', 'name speciality fees cabinNumber profileImage')
                .populate('sourceAppointmentId', 'bookingId patients appointmentDate clinicalSummary')
                .populate('bookedAppointmentId', 'bookingId tokenNumber formattedToken appointmentDate appointmentTime status')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            ReferredToAnotherDoctor.countDocuments({ clinicId, status: 'Pending-Clinic-Booking' }),
            ReferredToAnotherDoctor.countDocuments({ clinicId, status: 'Booked-And-Paid' })
        ]);

        return res.status(200).json({
            success: true,
            summary: { pendingCount, bookedCount },
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            count: referrals.length,
            data: referrals
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 7. CLINIC GETS SINGLE REFERRED CASE FULL DETAILS (Includes Doctor A's Prescription & Vitals)
// @route   GET /api/clinic/booking/referred-cases/:referralId
// ==========================================
const getSingleClinicReferredCase = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { referralId } = req.params;

        const idQuery = mongoose.Types.ObjectId.isValid(referralId)
            ? { $or: [{ _id: referralId }, { referralCode: referralId }] }
            : { referralCode: referralId };

        const referral = await ReferredToAnotherDoctor.findOne({ $and: [idQuery, { clinicId }] })
            .populate('userId', 'name phone email gender dob age bloodgroup profilePic')
            .populate('referredByDoctorId', 'name speciality qualification cabinNumber profileImage')
            .populate('referredToDoctorId', 'name speciality qualification fees cabinNumber profileImage dutyStatus')
            .populate('sourceAppointmentId')
            .populate('prescriptionId')
            .populate('bookedAppointmentId')
            .lean();

        if (!referral) {
            return res.status(404).json({ success: false, message: "Referred case not found." });
        }

        // Fetch all prescriptions written on the source appointment
        const sourcePrescriptions = referral.sourceAppointmentId?._id
            ? await Prescription.find({ appointmentId: referral.sourceAppointmentId._id })
                .populate('doctorId', 'name speciality qualification')
                .sort({ createdAt: -1 })
                .lean()
            : [];

        return res.status(200).json({
            success: true,
            data: {
                ...referral,
                sourcePrescriptions
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 8. CLINIC RECEPTION COLLECTS PAYMENT, SELECTS REFERRED SLOT & BOOKS APPOINTMENT
// @route   POST /api/clinic/booking/referred-cases/:referralId/confirm-and-pay
// ==========================================
const confirmAndPayReferredCase = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { referralId } = req.params;
        const {
            appointmentDate,
            appointmentTime,
            paymentMethod = 'Cash',
            amount,
            transactionReference = "",
            notes = ""
        } = req.body || {};

        if (!appointmentDate || !appointmentTime) {
            return res.status(400).json({
                success: false,
                message: "appointmentDate (YYYY-MM-DD) and appointmentTime are required."
            });
        }

        const idQuery = mongoose.Types.ObjectId.isValid(referralId)
            ? { $or: [{ _id: referralId }, { referralCode: referralId }] }
            : { referralCode: referralId };

        const referral = await ReferredToAnotherDoctor.findOne({ $and: [idQuery, { clinicId }] });
        if (!referral) {
            return res.status(404).json({ success: false, message: "Referred case not found." });
        }

        if (referral.status === 'Booked-And-Paid') {
            return res.status(400).json({
                success: false,
                message: "This referred case has already been booked and paid."
            });
        }

        const [sourceAppt, targetDoctor] = await Promise.all([
            Appointment.findById(referral.sourceAppointmentId).lean(),
            Doctor.findById(referral.referredToDoctorId).select('name speciality fees cabinNumber department').lean()
        ]);

        if (!targetDoctor) {
            return res.status(404).json({ success: false, message: "Target referred doctor not found." });
        }

        const payableFee = amount !== undefined ? Number(amount) : Number(targetDoctor.fees?.clinic || referral.feeAmount || 500);
        const targetDateObj = new Date(appointmentDate);
        const now = new Date();
        const newBookingId = `CLN-REF-${Math.floor(100000 + Math.random() * 900000)}`;

        // Create Confirmed OPD Appointment for the Referred Doctor
        const newAppointment = await Appointment.create({
            bookingId: newBookingId,
            userId: referral.userId,
            clinicId,
            doctorId: targetDoctor._id,
            doctorAcceptanceStatus: 'Pending',
            isReferredCase: true,
            referredByDoctorId: referral.referredByDoctorId,
            referredFromAppointmentId: referral.sourceAppointmentId,
            referralRecordId: referral._id,
            bookingType: 'Appointment',
            consultationType: 'Clinic Visit',
            bookingReason: notes || referral.reason || "Referred Specialist Consultation",
            appointmentDate: targetDateObj,
            appointmentTime: String(appointmentTime).trim(),
            patients: sourceAppt?.patients || [{ patientName: "Patient", patientAge: 30, gender: 'Male', relation: 'Self', isMainUser: true }],
            address: sourceAppt?.address || { addressType: 'Home' },
            pricingBreakdown: {
                baseFee: payableFee,
                originalBaseFee: payableFee,
                visitCharges: 0,
                extraCharges: 0,
                discountAmount: 0,
                subtotal: payableFee
            },
            totalAmount: payableFee,
            paymentStatus: 'Paid',
            status: 'Confirmed',
            paymentDetails: {
                method: paymentMethod,
                amount: payableFee,
                currency: 'INR',
                status: 'captured',
                razorpayPaymentId: transactionReference || `COUNTER-REF-${Date.now().toString().slice(-6)}`,
                paidAt: now
            },
            clinicalSummary: {
                chiefComplaint: sourceAppt?.clinicalSummary?.chiefComplaint || referral.reason,
                diagnosis: sourceAppt?.clinicalSummary?.diagnosis || "",
                doctorSuggestions: referral.clinicalNotes || sourceAppt?.clinicalSummary?.doctorSuggestions || "",
                vitals: sourceAppt?.clinicalSummary?.vitals || {}
            },
            treatmentHistory: [{
                fromDoctorId: referral.referredByDoctorId,
                toDoctorId: targetDoctor._id,
                action: 'Initial-Assignment',
                acceptanceStatus: 'Pending-Acceptance',
                assignedAt: now,
                notes: `Referred case booked at Clinic Reception for slot ${appointmentTime}.`,
                startTime: now
            }]
        });

        // Generate OPD Token under Referred Doctor's Queue
        await assignOpdTokenToAppointment(newAppointment);

        // Update Referral Record
        referral.status = 'Booked-And-Paid';
        referral.bookedAppointmentId = newAppointment._id;
        referral.referredDate = targetDateObj;
        referral.referredSlotTime = String(appointmentTime).trim();
        referral.feeAmount = payableFee;
        referral.paymentMethod = paymentMethod;
        referral.paymentStatus = 'Paid';
        referral.transactionReference = newAppointment.paymentDetails.razorpayPaymentId;
        referral.bookedAt = now;
        await referral.save();

        // Notify Referred Doctor & Patient
        Promise.allSettled([
            sendPushNotification(
                targetDoctor._id,
                'doctor',
                "New Referred Case Booked",
                `Clinic Reception booked a referred OPD case (#${newAppointment.bookingId} • Token #${newAppointment.formattedToken}) for ${appointmentTime}.`,
                { appointmentId: String(newAppointment._id), type: "CLINIC_REFERRED_APPT_BOOKED" }
            ),
            sendPushNotification(
                referral.userId,
                'user',
                "Referred Appointment Confirmed",
                `Your referred appointment with ${targetDoctor.name} is confirmed for ${moment(targetDateObj).format("DD MMM")} at ${appointmentTime} (Token #${newAppointment.formattedToken}).`,
                { appointmentId: String(newAppointment._id), formattedToken: newAppointment.formattedToken, type: "USER_REFERRED_APPT_CONFIRMED" }
            )
        ]).catch(() => {});

        return res.status(201).json({
            success: true,
            message: `Referred appointment booked & paid! Token #${newAppointment.formattedToken} assigned for ${targetDoctor.name}.`,
            data: {
                referral,
                appointment: newAppointment
            }
        });
    } catch (error) {
        console.error("Confirm And Pay Referred Case Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⏳ 9. CLINIC RECEPTION GETS PENDING BED ADMISSION HOLDS (With Live Countdown)
// @route   GET /api/clinic/booking/admissions/pending-holds
// ==========================================
const getClinicPendingAdmissionHolds = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const now = new Date();

        await syncClinicWardAndBedCapacity(clinicId);

        const pendingHolds = await Appointment.find({
            clinicId,
            bookingType: 'Admission',
            status: 'Clinic-Pending',
            paymentStatus: 'Pending',
            admissionHoldExpiresAt: { $gt: now }
        })
            .populate('userId', 'name phone email profilePic age gender')
            .populate('doctorId', 'name speciality cabinNumber profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('opdAppointmentId', 'bookingId tokenNumber formattedToken appointmentDate')
            .sort({ admissionHoldExpiresAt: 1 })
            .lean();

        const formattedData = pendingHolds.map((item) => {
            const holdDeadline = new Date(item.admissionHoldExpiresAt);
            const remainingSeconds = Math.max(0, Math.floor((holdDeadline.getTime() - now.getTime()) / 1000));

            return {
                admissionAppointmentId: item._id,
                admissionBookingId: item.bookingId,
                parentOpdBooking: item.opdAppointmentId ? {
                    opdBookingId: item.opdAppointmentId.bookingId,
                    formattedToken: item.opdAppointmentId.formattedToken
                } : null,
                patient: {
                    name: item.patients?.[0]?.patientName || item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    age: item.patients?.[0]?.patientAge || item.userId?.age || 30,
                    gender: item.patients?.[0]?.gender || item.userId?.gender || "Male"
                },
                doctor: {
                    doctorId: item.doctorId?._id,
                    name: item.doctorId?.name || "Doctor",
                    speciality: item.doctorId?.speciality || "Specialist",
                    cabinNumber: item.doctorId?.cabinNumber || ""
                },
                wardName: item.wardName || item.bedId?.wardId?.name,
                bedNumber: item.bedNumber || item.bedId?.bedNumber,
                bedId: item.bedId?._id,
                isVentilatorAvailable: Boolean(item.bedId?.isVentilatorAvailable),
                depositPayable: item.totalAmount || 0,
                stayDays: item.stayDuration || 1,
                triageLevel: item.triageLevel || "Urgent",
                bookingReason: item.bookingReason || "",
                holdMinutes: item.admissionHoldMinutes || 30,
                holdExpiresAt: item.admissionHoldExpiresAt,
                remainingSeconds,
                formattedRemainingTime: `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`,
                vitalsAtAdmission: item.clinicalSummary?.vitals || null,
                insuranceDetails: item.insuranceDetails || null
            };
        });

        return res.status(200).json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🛏️ 10. CLINIC RECEPTION COLLECTS ADMISSION DEPOSIT (Removes Hold & Allots Bed as Occupied)
// @route   PATCH /api/clinic/booking/admission/collect-payment/:id
// ==========================================
const collectClinicAdmissionCounterPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const rawPaymentMode = req.body?.paymentMode || req.body?.paymentMethod || 'Cash';
        const { transactionReference = "", remarks = "" } = req.body || {};

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            clinicId,
            bookingType: 'Admission',
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Bed admission record not found." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Deposit for this bed is already paid." });
        }

        const now = new Date();
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            await syncClinicWardAndBedCapacity(clinicId);
            return res.status(400).json({
                success: false,
                isExpired: true,
                message: `The ${appointment.admissionHoldMinutes || 30}-minute hold window for this bed has expired. Bed was released.`
            });
        }

        const bed = await Bed.findById(appointment.bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Assigned bed record not found." });
        }

        // Remove hold and allot bed as Occupied
        bed.status = 'Occupied';
        bed.holdExpiresAt = null;
        bed.currentAppointmentId = appointment._id;
        await bed.save();

        appointment.paymentStatus = 'Paid';
        appointment.status = 'In-Progress';
        appointment.admissionHoldExpiresAt = null;
        appointment.paymentDetails = {
            method: String(rawPaymentMode).trim(),
            amount: appointment.totalAmount,
            currency: 'INR',
            status: 'captured',
            paidAt: now,
            bank: remarks || "Clinic Reception Cash/POS Counter",
            razorpayPaymentId: transactionReference || `COUNTER-ADM-${Date.now().toString().slice(-6)}`
        };
        await appointment.save();

        await syncClinicWardAndBedCapacity(clinicId, bed.wardId);

        if (appointment.userId?._id) {
            sendPushNotification(
                appointment.userId._id,
                'user',
                "Admission & Bed Confirmed!",
                `Payment of ₹${appointment.totalAmount} received. Bed ${appointment.bedNumber} (${appointment.wardName}) is now allotted to you.`,
                { appointmentId: String(appointment._id), type: 'admission_confirmed' }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: `Bed hold removed & Bed ${appointment.bedNumber} (${appointment.wardName}) allotted! Deposit ₹${appointment.totalAmount} collected.`,
            bookingId: appointment.bookingId,
            bedNumber: appointment.bedNumber,
            wardName: appointment.wardName,
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔄 11. CLINIC RECEPTION SWITCHES HELD BED BEFORE PAYMENT
// @route   PATCH /api/clinic/booking/admission/switch-bed/:id
// ==========================================
const switchClinicHeldBedAtCounter = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const { newBedId } = req.body || {};

        if (!newBedId || !mongoose.isValidObjectId(newBedId)) {
            return res.status(400).json({ success: false, message: "Valid newBedId is required." });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            clinicId,
            bookingType: 'Admission',
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Bed admission record not found." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Deposit is already paid for this bed." });
        }

        const now = new Date();
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            await syncClinicWardAndBedCapacity(clinicId);
            return res.status(400).json({
                success: false,
                isExpired: true,
                message: "Hold has expired. Please ask doctor to re-initiate admission."
            });
        }

        const newTargetBed = await Bed.findOne({ _id: newBedId, clinicId }).populate('wardId');
        if (!newTargetBed || newTargetBed.status !== 'Available') {
            return res.status(400).json({ success: false, message: "Target bed is not available." });
        }

        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, {
                $set: { status: 'Available', holdExpiresAt: null, currentAppointmentId: null }
            });
        }

        newTargetBed.status = 'Reserved';
        newTargetBed.holdExpiresAt = appointment.admissionHoldExpiresAt;
        newTargetBed.currentAppointmentId = appointment._id;
        await newTargetBed.save();

        const days = Math.max(1, Number(appointment.stayDuration || 1));
        const newDeposit = Number(newTargetBed.pricePerDay || newTargetBed.wardId?.pricePerDay || 500) * days;
        const newWardTitle = newTargetBed.wardId?.name || "Clinic Ward";

        appointment.wardId = newTargetBed.wardId?._id || null;
        appointment.bedId = newTargetBed._id;
        appointment.bedNumber = newTargetBed.bedNumber;
        appointment.wardName = newWardTitle;
        appointment.totalAmount = newDeposit;
        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.baseFee = newDeposit;
        appointment.pricingBreakdown.visitCharges = newDeposit;
        appointment.pricingBreakdown.subtotal = newDeposit;
        await appointment.save();

        await syncClinicWardAndBedCapacity(clinicId);

        return res.status(200).json({
            success: true,
            message: `Bed switched to ${newWardTitle} (${newTargetBed.bedNumber}). New deposit: ₹${newDeposit}.`,
            newBedNumber: newTargetBed.bedNumber,
            newWardName: newWardTitle,
            newDepositPayable: newDeposit,
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    createClinicAppointmentByClinic,
    getClinicBookings,
    getSingleClinicBookingDetails,
    getClinicDirectBookings,
    getClinicBookingResources,
    getClinicReferredCases,
    getSingleClinicReferredCase,
    confirmAndPayReferredCase,
    getClinicPendingAdmissionHolds,
    collectClinicAdmissionCounterPayment,
    switchClinicHeldBedAtCounter
};