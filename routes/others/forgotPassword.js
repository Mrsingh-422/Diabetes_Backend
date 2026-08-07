const express = require('express');

const router = express.Router();

const { 

    forgotPassword, verifyOtp, resetPassword,

    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 

} = require('../../controllers/others/forgotPassword.js');
 
// Base URL: /api/password
 
// ==========================================

// ✉️ 1. Email OTP Flow (Existing)

// ==========================================

router.post('/forgot-password', forgotPassword); 

router.post('/verify-otp', verifyOtp);           

router.post('/reset-password', resetPassword);   
 
// ==========================================

// 📱 2. Firebase Mobile SMS OTP Flow (New)

// ==========================================

router.post('/forgot-password-phone', forgotPasswordPhone); // Verification checks before client triggers SMS

router.post('/verify-firebase-otp', verifyFirebaseOtp);     // Dynamic token validation and returns secure resetToken

router.post('/reset-password-phone', resetPasswordPhone);   // Resets password using valid resetToken
 
module.exports = router;
 