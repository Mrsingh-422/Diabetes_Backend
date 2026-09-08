// routes/user/Clinic/ClinicCheckoutRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { clinicUploads } = require('../../../middleware/multer.js');

const {
    calculateClinicBill,
    bookClinicOrder,
    verifyClinicPayment,
    getMyClinicBookings,
    getSingleClinicBooking
} = require('../../../controllers/user/Clinic/ClinicCheckout');

// Base URL: /api/clinic/checkout

// 1. Calculate / Preview Bill (Supports both JSON & FormData)
router.post('/calculate', protect('user'), clinicUploads, calculateClinicBill);

// 2.  Place / Confirm Clinic Booking (With PDF / Image Upload support)
router.post('/book', protect('user'),clinicUploads, bookClinicOrder);

// 3. Verify Razorpay Online Payment
router.post('/verify-payment', protect('user'), verifyClinicPayment);

// 4. Get User's Clinic Bookings List
router.get('/my-bookings', protect('user'), getMyClinicBookings);

// 5. Get Single Booking Full Details by ID
router.get('/booking/:id', protect('user'), getSingleClinicBooking);

module.exports = router;