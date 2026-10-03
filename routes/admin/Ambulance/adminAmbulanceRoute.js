// routes/admin/Ambulance/adminAmbulanceRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getAllAmbulancesForAdmin,
    getAmbulanceBookingsForAdmin,
    getAmbulanceBookingDetailsForAdmin,
    getCancelledAmbulanceBookingsForAdmin
} = require('../../../controllers/admin/Ambulance/adminAmbulance');

// Base Route: /admin/ambulances

// 1. Get All Ambulances List (Fleet with Filters & Ride Counts)
router.get('/list', protect('admin'), getAllAmbulancesForAdmin);

// 2. Get Bookings of an Ambulance (or pass /all/bookings for all rides)
router.get('/:ambulanceId/bookings', protect('admin'), getAmbulanceBookingsForAdmin);

// 3. Get Full Details of a Single Booking Order
router.get('/booking-details/:id', protect('admin'), getAmbulanceBookingDetailsForAdmin);

router.get('/cancelled-bookings', protect('admin'), getCancelledAmbulanceBookingsForAdmin);


module.exports = router;