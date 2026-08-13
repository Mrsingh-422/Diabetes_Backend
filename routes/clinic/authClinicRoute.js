// routes/clinic/authClinic.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { clinicUploads } = require('../../middleware/multer.js'); // Ensure clinic uploads are configured in multer middleware
const { 
    registerClinic, 
    loginClinic, 
    toggleClinicOnlineStatus,
    updateClinicProfile,
    getMyClinicProfile,
    // getLatestClinicProfileRequest,
    changeClinicPassword
} = require('../../controllers/clinic/authClinic.js');

// Base route: /api/auth/clinic

// --- Authentication ---
router.post('/register', registerClinic);
router.post('/login', loginClinic);

// --- Online status ---
router.patch('/status/toggle', protect('clinic'), toggleClinicOnlineStatus);

// --- Profile & Password Management ---
router.put('/profile/update',  
  protect('clinic'),
  clinicUploads, // Added Multer multi-field file handler [1]
  updateClinicProfile
);
router.get('/profile', protect('clinic'),getMyClinicProfile);
// router.get('/profile/update-status', protect('clinic'), getLatestClinicProfileRequest);
router.patch('/change-password', protect('clinic'), changeClinicPassword);

module.exports = router;