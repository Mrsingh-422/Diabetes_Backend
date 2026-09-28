// controllers/admin/Clinic/AdminClinicAppointmentsController.js
const Clinic = require('../../../models/Clinic');
const Appointment = require('../../../models/Appointment');
const mongoose = require('mongoose');

// ==========================================
// 🏥 1. GET APPROVED CLINICS LIST (SCREEN 1 - With Appointment Counts)
// Full Path: GET /api/admin/clinic-appointments/clinics
// ==========================================
const getApprovedClinicsList = async (req, res) => {
    try {
        const { search, city, page = 1, limit = 10 } = req.query;

        const query = {
            $or: [
                { Accountverify: 'Approved' },
                { profileStatus: 'Approved' }
            ]
        };

        if (city) {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { clinicName: regex },
                { name: regex },
                { email: regex },
                { phoneNumber: regex },
                { city: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await Clinic.countDocuments(query);

        // 1. Fetch Clinics
        const clinics = await Clinic.find(query)
            .select('_id name clinicName email phoneNumber city state address image posterimage Accountverify profileStatus isActive isOnline createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 2. 🧮 Fast Aggregation: Count Total & Active Appointments for each Clinic
        const appointmentCounts = await Appointment.aggregate([
            { $match: { clinicId: { $in: clinics.map(c => c._id) } } },
            {
                $group: {
                    _id: '$clinicId',
                    totalAppointmentsCount: { $sum: 1 },
                    activeAppointmentsCount: {
                        $sum: {
                            $cond: [
                                { $in: ['$status', ['Confirmed', 'In-Progress', 'Clinic-Pending', 'Discharge-Pending', 'Rescheduled']] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const countMap = new Map();
        appointmentCounts.forEach(c => countMap.set(c._id.toString(), c));

        // 3. Format Response strictly matching Screen 1 Table
        const formattedClinics = clinics.map(clinic => {
            const countInfo = countMap.get(clinic._id.toString()) || { totalAppointmentsCount: 0, activeAppointmentsCount: 0 };

            return {
                _id: clinic._id,
                clinicName: clinic.clinicName || clinic.name,
                doctorIncharge: clinic.name,
                email: clinic.email || "N/A",
                phone: clinic.phoneNumber || "N/A",
                city: clinic.city || "Mohali",
                state: clinic.state || "",
                address: clinic.address || "",
                image: clinic.image || clinic.posterimage || null,
                verification: (clinic.Accountverify || clinic.profileStatus || "APPROVED").toUpperCase(),
                isActive: clinic.isActive,
                isOnline: clinic.isOnline,
                totalAppointments: countInfo.totalAppointmentsCount,
                activeAppointments: countInfo.activeAppointmentsCount
            };
        });

        res.json({
            success: true,
            totalActiveClinics: totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: formattedClinics.length,
            data: formattedClinics
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 2. GET CLINIC APPOINTMENTS MODAL / LIST (SCREEN 2 - On Clinic Click)
// Full Path: GET /api/admin/clinic-appointments/:clinicId/appointments
// ==========================================
const getClinicAppointmentsModal = async (req, res) => {
    try {
        const { clinicId } = req.params;
        const { status, bookingType, search, page = 1, limit = 50 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(clinicId)) {
            return res.status(400).json({ success: false, message: "Invalid Clinic ID." });
        }

        // 1. Fetch Clinic Info
        const clinic = await Clinic.findById(clinicId)
            .select('_id name clinicName email phoneNumber city state address image')
            .lean();

        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        // 2. Query Appointments of this Clinic
        const apptQuery = { clinicId: clinic._id };

        if (status) apptQuery.status = status;

        if (bookingType) {
            const norm = bookingType.toUpperCase();
            if (norm === 'OPD') apptQuery.bookingType = 'Appointment';
            else if (norm === 'IPD') apptQuery.bookingType = 'Admission';
            else if (norm === 'EMERGENCY') apptQuery.bookingType = 'Emergency';
            else apptQuery.bookingType = bookingType;
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            apptQuery.$or = [
                { bookingId: regex },
                { "patients.patientName": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalAppointments = await Appointment.countDocuments(apptQuery);

        const appointments = await Appointment.find(apptQuery)
            .populate('doctorId', 'name speciality qualification profileImage phone')
            .populate('userId', 'name phone email profilePic')
            .populate('wardId', 'name type pricePerDay')
            .populate('bedId', 'bedNumber status pricePerDay')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 3. Format Response
        const formattedList = appointments.map(appt => {
            const primaryPatient = Array.isArray(appt.patients) && appt.patients.length > 0 ? appt.patients[0] : null;

            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                categoryTag: appt.bookingType === 'Admission' ? 'IPD' : (appt.bookingType === 'Emergency' ? 'EMERGENCY' : 'OPD'),
                bookingType: appt.bookingType,
                consultationType: appt.consultationType || 'Clinic Visit',

                // 👤 Patient Details
                patient: {
                    name: primaryPatient?.patientName || appt.userId?.name || "Patient",
                    phone: appt.address?.phone || appt.userId?.phone || "N/A",
                    age: primaryPatient?.patientAge || null,
                    gender: primaryPatient?.gender || "N/A",
                    relation: primaryPatient?.relation || "Self",
                    reasonForVisit: primaryPatient?.reasonForVisit || appt.bookingReason || ""
                },

                // 👨‍⚕️ Attending Doctor
                doctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    qualification: appt.doctorId.qualification,
                    profileImage: appt.doctorId.profileImage
                } : null,

                // 🏨 Inpatient Bed Stay
                stayDetails: appt.bedNumber || appt.wardName ? {
                    wardName: appt.wardName || appt.wardId?.name,
                    bedNumber: appt.bedNumber || appt.bedId?.bedNumber,
                    stayDuration: appt.stayDuration || 0
                } : null,

                appointmentDate: appt.appointmentDate ? new Date(appt.appointmentDate).toISOString().split('T')[0] : null,
                appointmentTime: appt.appointmentTime || "10:30 AM",

                // 💳 Payment
                amount: appt.totalAmount || 0,
                payment: {
                    paymentMethod: appt.paymentMethod || "COD",
                    paymentStatus: appt.paymentStatus || "Pending",
                    totalAmount: appt.totalAmount || 0,
                    razorpayPaymentId: appt.paymentDetails?.razorpayPaymentId || "",
                    paidAt: appt.paymentDetails?.paidAt || null
                },

                status: appt.status,
                createdAt: appt.createdAt
            };
        });

        res.json({
            success: true,
            clinic: {
                _id: clinic._id,
                name: clinic.clinicName || clinic.name,
                email: clinic.email || "N/A",
                phone: clinic.phoneNumber || "N/A",
                city: clinic.city || "Mohali",
                image: clinic.image
            },
            totalAssociatedAppointments: totalAppointments,
            totalPages: Math.ceil(totalAppointments / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            count: formattedList.length,
            appointments: formattedList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚫 3. GET ALL CANCELLED CLINIC APPOINTMENTS
// Full Path: GET /api/admin/clinic-appointments/cancelled-appointments
// ==========================================
const getAllCancelledClinicAppointments = async (req, res) => {
    try {
        const { clinicId, search, page = 1, limit = 20 } = req.query;

        const query = {
            clinicId: { $ne: null, $exists: true },
            status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'Cancelled'] }
        };

        if (clinicId && mongoose.Types.ObjectId.isValid(clinicId)) {
            query.clinicId = clinicId;
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { "cancellationDetails.reason": regex },
                { "patients.patientName": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await Appointment.countDocuments(query);

        const cancelledAppointments = await Appointment.find(query)
            .populate('clinicId', 'name clinicName city phoneNumber image')
            .populate('doctorId', 'name speciality profileImage phone')
            .populate('userId', 'name phone email profilePic')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const formattedList = cancelledAppointments.map(appt => {
            const primaryPatient = Array.isArray(appt.patients) && appt.patients.length > 0 ? appt.patients[0] : null;
            const cDetails = appt.cancellationDetails || {};

            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                bookingType: appt.bookingType,
                consultationType: appt.consultationType || 'Clinic Visit',
                status: appt.status,

                // 🚫 Cancellation Details
                cancelReason: cDetails.reason || "No cancellation reason provided.",
                cancelledAt: cDetails.cancelledAt || appt.updatedAt,
                isPermanent: Boolean(cDetails.isPermanent),
                refundAmountCalculated: cDetails.refundAmountCalculated || 0,
                penaltyApplied: cDetails.penaltyApplied || 0,

                // 👤 Patient Info
                patient: {
                    name: primaryPatient?.patientName || appt.userId?.name || "Patient",
                    phone: appt.address?.phone || appt.userId?.phone || "N/A",
                    email: appt.userId?.email || "N/A"
                },

                // 🏥 Clinic Info
                clinic: {
                    _id: appt.clinicId?._id || null,
                    name: appt.clinicId?.clinicName || appt.clinicId?.name || "Clinic",
                    city: appt.clinicId?.city || "Mohali",
                    phone: appt.clinicId?.phoneNumber || "N/A",
                    image: appt.clinicId?.image || null
                },

                // 👨‍⚕️ Doctor Info
                doctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    phone: appt.doctorId.phone || "N/A"
                } : null,

                // 💳 Payment Details
                payment: {
                    paymentMethod: appt.paymentMethod || "COD",
                    paymentStatus: appt.paymentStatus || "Pending",
                    totalAmount: appt.totalAmount || 0,
                    razorpayPaymentId: appt.paymentDetails?.razorpayPaymentId || "",
                    paidAt: appt.paymentDetails?.paidAt || null
                },

                createdAt: appt.createdAt,
                updatedAt: appt.updatedAt
            };
        });

        res.json({
            success: true,
            totalCancelledAppointments: totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: formattedList.length,
            data: formattedList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getApprovedClinicsList,
    getClinicAppointmentsModal,
    getAllCancelledClinicAppointments
};