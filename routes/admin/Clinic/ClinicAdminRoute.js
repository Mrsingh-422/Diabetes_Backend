const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware.js'); 
const {
    getClinics,
    approveClinicStatus,
    toggleClinicActiveStatus,
    adminGetApprovedClinics,
    getClinicDoctorsAdmin,
    getClinicDoctorDetailsAdmin,
    approveClinicDoctorStatus
} = require('../../../controllers/clinic/ClinicAdmin.js'); 

// Base route : /api/admin/clinic

// --- CLINIC VERIFICATION & LIST ---
router.get('/list', protect('admin'), getClinics);
router.patch('/approve/:id', protect('admin'), approveClinicStatus);
router.patch('/toggle-active/:id', protect('admin'), toggleClinicActiveStatus);
router.get('/approved-list', protect('admin'), adminGetApprovedClinics);

// --- 🚀 CLINIC DOCTOR MODERATION ---
router.get('/doctors/list', protect('admin'), getClinicDoctorsAdmin);
router.get('/doctors/details/:id', protect('admin'), getClinicDoctorDetailsAdmin);
router.patch('/doctors/approve/:id', protect('admin'), approveClinicDoctorStatus);

module.exports = router;