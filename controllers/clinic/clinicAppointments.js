// controllers/clinic/clinicAppointments.js

const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const Clinic = require('../../models/Clinic');
const Ambulance = require('../../models/Ambulance');
const Bed = require('../../models/Bed');
const Ward = require('../../models/Ward');
const User = require('../../models/User');
const crypto = require('crypto');
// Safe JSON parser for FormData
const parseField = (val) => {
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
};

// ==========================================
// 🏥 1. CREATE CLINIC APPOINTMENT / ADMISSION
// Full Path: POST /api/clinic/booking/create
// ==========================================
const createClinicAppointmentByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id; // Logged-in clinic from protect('clinic')
        const body = req.body || {};

        // 1. Extract Basic Patient Info
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

        // ========================================================
        // 👤 STEP 1: USER REGISTRATION (NO DUMMY PASSWORD)
        // ========================================================
        let user = await User.findOne({ 
            $or: [
                { phone: patientPhone },
                { phone: patientPhone, countryCode }
            ]
        });
        
        if (!user) {
            // Clean User Creation with isUserRegistered: true & isPasswordAvailable: false
            user = await User.create({
                name: relation.toLowerCase() === 'self' ? patientName : (address?.name || patientName),
                phone: patientPhone,
                countryCode: countryCode,
                password: null,                // 👈 NO DUMMY PASSWORD (Clean null)
                isUserRegistered: true,        // 👈 User is registered in system
                isPasswordAvailable: false,    // 👈 Password is NOT available yet
                profileStatus: 'Incomplete',   // 👈 Incomplete profile until full KYC
                role: 'user',
                userAddress: [],
                familyMember: []
            });
        }

        // ========================================================
        // 👨‍👩‍👦 STEP 2: FAMILY MEMBER HANDLING
        // ========================================================
        const isSelfBooking = relation.toLowerCase() === 'self';
        
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

        // 2. Booking Core Configurations
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

        // 3. Doctor Verification & Fee
        let verifiedDoctor = null;
        let doctorFee = 0;
        if (doctorId) {
            verifiedDoctor = await Doctor.findOne({ _id: doctorId, clinicId });
            if (verifiedDoctor) {
                doctorFee = Number(verifiedDoctor.fees?.clinic || 500);
            }
        }

        // 4. Ambulance Verification
        let verifiedAmbulance = null;
        let ambulanceFee = 0;
        if (ambulanceId) {
            verifiedAmbulance = await Ambulance.findOne({ _id: ambulanceId, clinicId });
            if (verifiedAmbulance) {
                ambulanceFee = Number(verifiedAmbulance.pricing?.singleRidePrice || 400);
            }
        }

        // 5. Bed Verification & Occupancy Validation
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

        // 6. Pricing Calculation
        const subtotal = Number(body.totalAmount) || (doctorFee + bedFee + ambulanceFee);
        const tempBookingId = `CLN-ADM-${Math.floor(100000 + Math.random() * 900000)}`;

        // 7. Create Master Appointment
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
                patientName: patientName,
                patientAge: patientAge,
                gender: patientGender,
                relation: relation,
                reasonForVisit: symptoms,
                isMainUser: isSelfBooking
            }],

            address: address ? {
                name: address.name || patientName,
                phone: patientPhone,
                houseNo: address.houseNo || "",
                sector: address.sector || "",
                landmark: address.landmark || "",
                city: address.city || "",
                state: address.state || "",
                pincode: address.pincode || "",
                addressType: address.addressType || "Home"
            } : {
                name: patientName,
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

        // 8. Update Database Bed status to Occupied
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

        res.status(201).json({
            success: true,
            message: "Clinic booking created successfully! Bed marked Occupied & linked to user account.",
            data: {
                _id: newAppointment._id,
                bookingId: newAppointment.bookingId,
                bookingType: newAppointment.bookingType,
                status: newAppointment.status,
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
// 📋 2. GET ALL CLINIC BOOKINGS (With Pagination, OPD/IPD/Emergency Filter & Search)
// Full Path: GET /api/clinic/booking/all-bookings
// ==========================================
const getClinicBookings = async (req, res) => {
    try {
        const clinicId = req.user.id; // Logged-in clinic ID from protect('clinic')
        const { 
            status, 
            bookingType, 
            type, 
            search, 
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

        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: searchRegex },
                { "patients.patientName": searchRegex },
                { "address.name": searchRegex },
                { "address.phone": searchRegex }
            ];
        }

        const totalDocs = await Appointment.countDocuments(query);

        const bookings = await Appointment.find(query)
            .select('_id bookingId bookingType consultationType status paymentStatus totalAmount appointmentDate appointmentTime wardName bedNumber startDate endDate clinicId doctorId patients address createdAt')
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
                patientName: primaryPatient?.patientName || b.address?.name || b.userId?.name || "Patient",
                patientAge: primaryPatient?.patientAge || null,
                patientGender: primaryPatient?.gender || null,
                wardInfo: b.wardName ? `${b.wardName} (Bed #${b.bedNumber})` : null,
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
module.exports = {
    createClinicAppointmentByClinic,
    getClinicBookings,
    getSingleClinicBookingDetails,
    getClinicDirectBookings,
    getClinicBookingResources
};