// routes/user/Ambulance/ambulanceBookingRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    bookEmergencyAmbulance,
    acceptEmergencyBooking,
    bookReferralAmbulance,
    getMyAmbulanceRides,
    verifyAmbulancePayment,
    calculateAmbulanceFare
} = require('../../../controllers/user/Ambulance/ambulanceBooking');

// Base URL: /api/user/ambulance/booking

// 🚨 1. Flow 1: Emergency Ambulance Booking (Broadcasts to all nearby)
router.post('/emergency', protect('user'), bookEmergencyAmbulance);

// 🚑 Flow 1 (Driver Side): Driver Accepts Emergency Ride
router.post('/accept-emergency', protect(['ambulance', 'clinic-ambulance']), acceptEmergencyBooking);

// 📋 2. Flow 2: Referral / Scheduled Booking (With slots, doctor/nurse, coupon)
router.post('/referral', protect('user'), bookReferralAmbulance);

// 🔍 3. User My Rides List
router.get('/my-rides', protect('user'), getMyAmbulanceRides);

// 💳 4. Verify Razorpay Payment (Confirm Online Ride)
router.post('/verify-payment', protect('user'), verifyAmbulancePayment);

//  1. Calculate Fare / Checkout Preview (Protected with user token)
router.post('/calculate-fare', protect('user'), calculateAmbulanceFare);

module.exports = router;