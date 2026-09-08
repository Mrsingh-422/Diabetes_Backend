// controllers/clinic/clinicAppointments.js

const Appointment = require('../../models/Appointment');

// ==========================================
// 📋 1. GET ALL CLINIC BOOKINGS (With Pagination, OPD/IPD/Emergency Filter & Search)
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

        // Base Query: Strictly for this logged-in clinic
        const query = { clinicId };

        // 1. Status Filter (E.g. ?status=Confirmed ya ?status=Pending)
        if (status) {
            query.status = status;
        }

        // 2. 🌟 Smart OPD / IPD / Emergency Category Filter
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

        // 3. 🔍 Search Filter (By Booking ID, Patient Name, or Contact Phone)
        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: searchRegex },
                { "patients.patientName": searchRegex },
                { "address.name": searchRegex },
                { "address.phone": searchRegex }
            ];
        }

        // Total Count for Pagination
        const totalDocs = await Appointment.countDocuments(query);

        // 🚨 Select essential card fields for fast rendering
        const bookings = await Appointment.find(query)
            .select('_id bookingId bookingType consultationType status paymentStatus totalAmount appointmentDate appointmentTime wardName bedNumber startDate endDate clinicId doctorId patients address createdAt')
            .populate('clinicId', 'name clinicName city image')
            .populate('doctorId', 'name speciality profileImage')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // 🛡️ Format clean lightweight card payload
        const cleanList = bookings.map(b => {
            const dateVal = b.appointmentDate || b.startDate;
            const primaryPatient = Array.isArray(b.patients) && b.patients.length > 0 ? b.patients[0] : null;

            return {
                _id: b._id,
                bookingId: b.bookingId,
                bookingType: b.bookingType,                       // 'Appointment' (OPD), 'Admission' (IPD), 'Emergency'
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
// 🔍 2. GET SINGLE CLINIC BOOKING FULL DETAILS
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

module.exports = {
    getClinicBookings,
    getSingleClinicBookingDetails
};