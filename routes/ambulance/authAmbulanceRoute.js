// routes/ambulance/authAmbulance.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const { 
    registerAmbulance, 
    loginAmbulance, 
    completeAmbulanceProfile, 
    toggleDriverAvailability,
    getMyAmbulanceProfile,
    updateAmbulanceProfile,
    forgotPasswordAmbulance, 
    verifyRecoveryOtp, 
    resetPasswordWithOtp
} = require('../../controllers/ambulance/authAmbulance');

// Base URL: /api/auth/ambulance

// 1. Auth & Onboarding
router.post('/register', registerAmbulance);
router.post('/login', loginAmbulance);
router.put('/complete-profile', protect(['ambulance', 'clinic-ambulance']), ambulanceDocUploads, completeAmbulanceProfile);

// 2. Status & Profile
router.patch('/status/toggle', protect(['ambulance', 'clinic-ambulance']), toggleDriverAvailability);
router.get('/profile', protect(['ambulance', 'clinic-ambulance']), getMyAmbulanceProfile);
router.patch('/profile/update', protect(['ambulance', 'clinic-ambulance']), updateAmbulanceProfile);

// 3. Password Recovery Flow
router.post('/forgot-password', forgotPasswordAmbulance);
router.post('/verify-recovery-otp', verifyRecoveryOtp);
router.patch('/reset-password-otp', resetPasswordWithOtp);

module.exports = router;