// routes/clinic/clinicDoctorPannel/clinicDocCasesRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getClinicDoctorOpdList,
    getClinicDoctorOpdById,
    getClinicDoctorIpdList,
    getClinicDoctorIpdById,
    getClinicDoctorEmergencyList,
    getClinicDoctorEmergencyById
} = require('../../../controllers/clinic/clinicDoctorPannel/clinicDocCases');

// Base Route: /api/clinic/doctor-panel

// --- OPD (Consultation Appointments) ---
router.get('/opd/appointments', protect('clinic-doctor'), getClinicDoctorOpdList);
router.get('/opd/appointments/:id', protect('clinic-doctor'), getClinicDoctorOpdById);

// --- IPD (Ward / Bed Admissions) ---
router.get('/ipd/appointments', protect('clinic-doctor'), getClinicDoctorIpdList);
router.get('/ipd/appointments/:id', protect('clinic-doctor'), getClinicDoctorIpdById);

// --- EMERGENCY ---
router.get('/emergency/appointments', protect('clinic-doctor'), getClinicDoctorEmergencyList);
router.get('/emergency/appointments/:id', protect('clinic-doctor'), getClinicDoctorEmergencyById);

module.exports = router;