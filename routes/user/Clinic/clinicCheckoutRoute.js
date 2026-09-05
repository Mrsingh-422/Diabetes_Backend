// routes/user/Clinic/clinicCheckoutRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    calculateCheckoutBill,
    bookClinicAppointment,
    verifyClinicPayment,
    getMyClinicAppointments,
    getSingleClinicAppointment
} = require('../../../controllers/user/Clinic/clinicCheckoutController');

// Base URL: /api/user/clinic-checkout

// 1. Preview Bill Breakdown & Price Calculation
router.post('/calculate', protect('user'), calculateCheckoutBill);

// 2. Book Appointment & Initiate Order (COD or Razorpay)
router.post('/book', protect('user'), bookClinicAppointment);

// 3. Verify Razorpay Online Payment
router.post('/verify-payment', protect('user'), verifyClinicPayment);

// 4. User Clinic Appointments History
router.get('/my-appointments', protect('user'), getMyClinicAppointments);

// 5. Single Appointment Live Status & Token View
router.get('/appointment/:id', protect('user'), getSingleClinicAppointment);

module.exports = router;