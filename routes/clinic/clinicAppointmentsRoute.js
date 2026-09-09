// routes/clinic/clinicAppointmentsRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { clinicUploads } = require('../../middleware/multer'); // Multer with medicalDocument support

const {
    createClinicAppointmentByClinic,
    getClinicBookings,
    getSingleClinicBookingDetails,
    getClinicDirectBookings,
    getClinicBookingResources
} = require('../../controllers/clinic/clinicAppointments');

// Base URL: /api/clinic/booking

// 1. Create Appointment/Admission from Clinic Desk (With Multer for medicalDocument/Prescription)
router.post('/create', protect('clinic'), clinicUploads, createClinicAppointmentByClinic);

router.get('/direct-bookings', protect('clinic'), getClinicDirectBookings);

router.get('/resources', protect('clinic'), getClinicBookingResources);

// 2. Get All Clinic Bookings (Paginated & Filtered by OPD/IPD/Emergency)
router.get('/all-bookings', protect('clinic'), getClinicBookings);

// 3. Get Single Booking Full Details by ID or bookingId
router.get('/booking/:bookingId', protect('clinic'), getSingleClinicBookingDetails);

module.exports = router;