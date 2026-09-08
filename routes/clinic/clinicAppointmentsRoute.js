// routes/clinic/clinicAppointments.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {
    getClinicBookings,
    getSingleClinicBookingDetails
} = require('../../controllers/clinic/clinicAppointments');

// Base URL: /api/clinic/booking

// 1. Get All Clinic Bookings (Paginated & Filtered by OPD/IPD/Emergency)
router.get('/all-bookings', protect('clinic'), getClinicBookings);

// 2. Get Single Booking Full Details by ID or bookingId
router.get('/booking/:bookingId', protect('clinic'), getSingleClinicBookingDetails);

module.exports = router;