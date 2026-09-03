// routes/clinic/clinicWardBedRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
    createClinicWardUnit,
    getClinicWards,
    getBedsInClinicWard,
    updateClinicWardInfo,
    updateClinicWardBeds,
    deleteSpecificClinicBed,
    deleteClinicWard,
    updateClinicBedStatus,
    admitPatientToClinicBed,
    assignDoctorToClinicAdmission,
    getAllClinicAdmissions
} = require('../../controllers/clinic/clinicWardBedController');

// Base Route: /api/clinic/wards

// --- WARD UNIT OPERATIONS ---
router.post('/create', protect('clinic'), createClinicWardUnit);
router.get('/list', protect('clinic'), getClinicWards);
router.put('/update/:wardId', protect('clinic'), updateClinicWardInfo);
router.delete('/delete/:wardId', protect('clinic'), deleteClinicWard);

// --- BED INVENTORY & GRID ---
router.get('/:wardId/beds', protect('clinic'), getBedsInClinicWard);
router.put('/update-beds', protect('clinic'), updateClinicWardBeds);
router.delete('/bed/:bedId', protect('clinic'), deleteSpecificClinicBed);
router.patch('/bed/status', protect('clinic'), updateClinicBedStatus);

// --- PATIENT ADMISSIONS & DOCTOR ASSIGNMENT ---
router.post('/admit-patient', protect('clinic'), admitPatientToClinicBed);
router.post('/assign-doctor', protect('clinic'), assignDoctorToClinicAdmission);
router.get('/admissions/all', protect('clinic'), getAllClinicAdmissions);

module.exports = router;