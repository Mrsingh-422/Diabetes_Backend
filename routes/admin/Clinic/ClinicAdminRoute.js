const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware.js'); 
const {
    getClinics,
    approveClinicStatus,
    toggleClinicActiveStatus,
    adminGetApprovedClinics
} = require('../../../controllers/clinic/ClinicAdmin.js'); 

// Base route : /api/admin/clinic

// --- 1. Get Clinics with Search, Filter & Pagination ---
router.get('/list', protect('admin'), getClinics);

// --- 2. Approve or Reject Clinic ---
router.patch('/approve/:id', protect('admin'), approveClinicStatus);

// --- 3. Active / Inactive Toggle ---
router.patch('/toggle-active/:id', protect('admin'), toggleClinicActiveStatus);

// --- 4. Approved List (Limit 25) ---
router.get('/approved-list', protect('admin'), adminGetApprovedClinics);

module.exports = router;