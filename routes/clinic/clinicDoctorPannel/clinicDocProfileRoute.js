// routes/clinic/clinicDoctorPannel/clinicDocProfileRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../../middleware/multer');

const {
    getMyDoctorProfile,
    updateDoctorProfile,
    getLatestDoctorProfileRequest,
    applyDoctorLeave,
    getDoctorLeavesHistory,
    checkDoctorBusyStatus,
    updateDoctorDutyStatus,
    getDoctorOpdSettings
} = require('../../../controllers/clinic/clinicDoctorPannel/clinicDocProfile');

// Base Route: /api/clinic/doctor-panel

// --- PROFILE & APPROVAL STATUS ---
router.get('/profile', protect('clinic-doctor'), getMyDoctorProfile);
router.put('/profile/update', protect('clinic-doctor'), doctorDocUploads, updateDoctorProfile);
router.get('/profile/update-status', protect('clinic-doctor'), getLatestDoctorProfileRequest);

// --- OPD SLOTS, SCHEDULE & FEES ---
router.get('/opd-settings', protect('clinic-doctor'), getDoctorOpdSettings);

// --- LEAVES ---
router.post('/leaves/apply', protect('clinic-doctor'), applyDoctorLeave);
router.get('/leaves', protect('clinic-doctor'), getDoctorLeavesHistory);

// --- BUSY / DUTY STATUS ---
router.get('/busy-status', protect(['clinic-doctor', 'clinic']), checkDoctorBusyStatus);
router.get('/busy-status/:doctorId', protect(['clinic-doctor', 'clinic']), checkDoctorBusyStatus);
router.patch('/duty-status', protect('clinic-doctor'), updateDoctorDutyStatus);

module.exports = router;