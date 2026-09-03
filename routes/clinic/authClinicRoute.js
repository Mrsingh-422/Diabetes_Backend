// routes/clinic/authClinic.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { clinicUploads } = require('../../middleware/multer.js');

const { 
    registerClinic, 
    loginClinic, 
    toggleClinicOnlineStatus,
    updateClinicProfile,
    getLatestClinicProfileRequest, // 👈 Active import
    getMyClinicProfile,
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
  clinicUploads,
  updateClinicProfile
);

router.get('/profile', protect('clinic'), getMyClinicProfile);

// 🌟 Check Pending Request Status in Clinic Dashboard
router.get('/profile/update-status', protect('clinic'), getLatestClinicProfileRequest);

router.patch('/change-password', protect('clinic'), changeClinicPassword);

module.exports = router;