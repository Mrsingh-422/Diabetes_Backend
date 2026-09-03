// routes/user/clinicManageRoute.js
const express = require('express');
const router = express.Router();
const {
    getAllClinicsForUser,
    getClinicDetailsForUser
} = require('../../controllers/user/Clinic/clinicManageController');

// Base Route: /api/user/clinics

// 1. Get All Clinics (Cards Listing with City, Search & Distance)
router.get('/', getAllClinicsForUser);

// 2. Get Single Clinic Full Details & Its Doctors (3-Way Fees, Qualifications & Timings)
router.get('/:id', getClinicDetailsForUser);

module.exports = router;