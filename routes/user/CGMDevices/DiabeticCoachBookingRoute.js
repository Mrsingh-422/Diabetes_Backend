// routes/user/CGMDevices/DiabeticCoachBookingRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    calculateCoachBill,
    bookDiabetesCoach,
    verifyCoachPayment,
    getMyCoachBookings,
    getCoachBookingById,
    cancelCoachBooking
} = require('../../../controllers/user/CGMDevices/DiabeticCoachBooking');

// Base URL: /api/user/coach-booking

// 🧮 1. Calculate Fare Preview
router.post('/calculate-bill', protect('user'), calculateCoachBill);

// 🛍️ 2. Book Coach (COD or Online initiation)
router.post('/book', protect('user'), bookDiabetesCoach);

// 💳 3. Verify Razorpay Payment
router.post('/verify-payment', protect('user'), verifyCoachPayment);

// 📋 4. Get My Bookings List
router.get('/my-bookings', protect('user'), getMyCoachBookings);

// 🔍 5. Get Single Booking Full Details by ID
router.get('/booking/:id', protect('user'), getCoachBookingById);

// 🚫 6. Cancel Booking by User
router.patch('/cancel/:id', protect('user'), cancelCoachBooking);

module.exports = router;