// routes/user/Ambulance/ambulanceBookingRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    bookEmergencyAmbulance,
    acceptEmergencyBooking,
    bookReferralAmbulance,
    verifyAmbulancePayment,
    calculateAmbulanceFare,
    getUserAmbulanceBookings,
    getUserAmbulanceBookingById
} = require('../../../controllers/user/Ambulance/ambulanceBooking');

// Base URL: /api/user/ambulance/booking

// 🚨 1. Flow 1: Emergency Ambulance Booking (Broadcasts to all nearby)
router.post('/emergency', protect('user'), bookEmergencyAmbulance);

// 🚑 Flow 1 (Driver Side): Driver Accepts Emergency Ride
router.post('/accept-emergency', protect(['ambulance', 'clinic-ambulance']), acceptEmergencyBooking);

// 📋 2. Flow 2: Referral / Scheduled Booking (With slots, doctor/nurse, coupon)
router.post('/referral', protect('user'), bookReferralAmbulance);

// 💳 4. Verify Razorpay Payment (Confirm Online Ride)
router.post('/verify-payment', protect('user'), verifyAmbulancePayment);

//  1. Calculate Fare / Checkout Preview (Protected with user token)
router.post('/calculate-fare', protect('user'), calculateAmbulanceFare);

// 📋 1. Get All Orders (Summary List)
router.get('/my-orders', protect('user'), getUserAmbulanceBookings);

// 🔍 2. Get Single Order Full Details by ID
router.get('/order/:id', protect('user'), getUserAmbulanceBookingById);

module.exports = router;