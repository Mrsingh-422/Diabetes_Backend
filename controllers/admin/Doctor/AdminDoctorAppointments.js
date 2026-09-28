// controllers/admin/Doctor/AdminDoctorAppointments.js
const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const mongoose = require('mongoose');

// ==========================================
// 👨‍⚕️ 1. GET APPROVED INDEPENDENT DOCTORS LIST (SCREEN 1 - With Appointment Counts)
// Full Path: GET /api/admin/doctor-appointments/doctors
// ==========================================
const getApprovedIndependentDoctorsList = async (req, res) => {
    try {
        const { search, speciality, city, page = 1, limit = 10 } = req.query;

        // Query only Approved Independent Doctors (clinicId is null/does not exist)
        const query = {
            profileStatus: 'Approved',
            role: 'doctor',
            $or: [
                { clinicId: null },
                { clinicId: { $exists: false } }
            ]
        };

        if (speciality) {
            query.speciality = { $regex: speciality.trim(), $options: 'i' };
        }

        if (city) {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { email: regex },
                { phone: regex },
                { speciality: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await Doctor.countDocuments(query);

        // 1. Fetch Doctors
        const doctors = await Doctor.find(query)
            .select('_id name email phone speciality qualification experienceYears city state profileImage fees averageRating totalReviews profileStatus isActive isOnline createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 2. 🧮 Fast Aggregation: Count Total & Active Appointments for each Doctor
        const appointmentCounts = await Appointment.aggregate([
            { $match: { doctorId: { $in: doctors.map(d => d._id) }, clinicId: null } },
            {
                $group: {
                    _id: '$doctorId',
                    totalAppointmentsCount: { $sum: 1 },
                    activeAppointmentsCount: {
                        $sum: {
                            $cond: [
                                { $in: ['$status', ['Confirmed', 'In-Progress', 'Rescheduled']] },
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
        const formattedDoctors = doctors.map(doc => {
            const countInfo = countMap.get(doc._id.toString()) || { totalAppointmentsCount: 0, activeAppointmentsCount: 0 };

            return {
                _id: doc._id,
                doctorName: doc.name,
                email: doc.email || "N/A",
                phone: doc.phone || "N/A",
                speciality: doc.speciality || "General Physician",
                qualification: doc.qualification || "MBBS",
                experienceYears: doc.experienceYears || 0,
                city: doc.city || "Mohali",
                state: doc.state || "",
                fees: doc.fees || {},
                profileImage: doc.profileImage || null,
                verification: (doc.profileStatus || "APPROVED").toUpperCase(),
                isActive: doc.isActive,
                isOnline: doc.isOnline,
                rating: doc.averageRating || 0,
                totalAppointments: countInfo.totalAppointmentsCount,
                activeAppointments: countInfo.activeAppointmentsCount
            };
        });

        res.json({
            success: true,
            totalActiveDoctors: totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: formattedDoctors.length,
            data: formattedDoctors
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 2. GET DOCTOR APPOINTMENTS MODAL / LIST (SCREEN 2 - On Doctor Click)
// Full Path: GET /api/admin/doctor-appointments/:doctorId/appointments
// ==========================================
const getDoctorAppointmentsModal = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { status, consultationType, search, page = 1, limit = 50 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid Doctor ID." });
        }

        // 1. Fetch Doctor Info
        const doctor = await Doctor.findById(doctorId)
            .select('_id name email phone speciality qualification experienceYears city state profileImage fees averageRating')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        // 2. Query Appointments of this Independent Doctor
        const apptQuery = {
            doctorId: doctor._id,
            $or: [
                { clinicId: null },
                { clinicId: { $exists: false } }
            ]
        };

        if (status) apptQuery.status = status;
        if (consultationType) apptQuery.consultationType = consultationType;

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
            .populate('userId', 'name phone email profilePic')
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
                consultationType: appt.consultationType || 'Video Consult',

                // 👤 Patient Details
                patient: {
                    name: primaryPatient?.patientName || appt.userId?.name || "Patient",
                    phone: appt.address?.phone || appt.userId?.phone || "N/A",
                    age: primaryPatient?.patientAge || null,
                    gender: primaryPatient?.gender || "N/A",
                    relation: primaryPatient?.relation || "Self",
                    reasonForVisit: primaryPatient?.reasonForVisit || appt.bookingReason || ""
                },

                appointmentDate: appt.appointmentDate ? new Date(appt.appointmentDate).toISOString().split('T')[0] : null,
                appointmentTime: appt.appointmentTime || "10:00 AM",

                // 💳 Payment Details
                amount: appt.totalAmount || 0,
                payment: {
                    paymentMethod: appt.paymentMethod || "Online",
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
            doctor: {
                _id: doctor._id,
                name: doctor.name,
                email: doctor.email || "N/A",
                phone: doctor.phone || "N/A",
                speciality: doctor.speciality || "General Physician",
                qualification: doctor.qualification || "MBBS",
                profileImage: doctor.profileImage,
                rating: doctor.averageRating || 0
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
// 🚫 3. GET ALL CANCELLED DOCTOR APPOINTMENTS
// Full Path: GET /api/admin/doctor-appointments/cancelled-appointments
// ==========================================
const getAllCancelledDoctorAppointments = async (req, res) => {
    try {
        const { doctorId, search, page = 1, limit = 20 } = req.query;

        const query = {
            $or: [
                { clinicId: null },
                { clinicId: { $exists: false } }
            ],
            status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled'] }
        };

        if (doctorId && mongoose.Types.ObjectId.isValid(doctorId)) {
            query.doctorId = doctorId;
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
            .populate('doctorId', 'name speciality phone profileImage email')
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
                consultationType: appt.consultationType || 'Video Consult',
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

                // 👨‍⚕️ Doctor Info
                doctor: {
                    _id: appt.doctorId?._id || null,
                    name: appt.doctorId?.name || "Doctor",
                    speciality: appt.doctorId?.speciality || "Specialist",
                    phone: appt.doctorId?.phone || "N/A",
                    profileImage: appt.doctorId?.profileImage || null
                },

                // 💳 Payment Details
                payment: {
                    paymentMethod: appt.paymentMethod || "Online",
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
    getApprovedIndependentDoctorsList,
    getDoctorAppointmentsModal,
    getAllCancelledDoctorAppointments
};