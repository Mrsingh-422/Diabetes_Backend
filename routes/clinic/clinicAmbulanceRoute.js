// routes/clinic/clinicAmbulanceRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const {
    addClinicAmbulance,
    getMyClinicAmbulances,
    updateClinicAmbulance,
    toggleClinicAmbulanceStatus,
    deleteClinicAmbulance,
    loginClinicAmbulance
} = require('../../controllers/clinic/clinicAmbulanceController');

// Base Route: /api/clinic/ambulance

// 1. Driver / Ambulance Auth Login (Public)
router.post('/login', loginClinicAmbulance);

// 2. Clinic Protected CRUD Operations
router.post('/add', protect('clinic'), ambulanceDocUploads, addClinicAmbulance);
router.get('/my-ambulances', protect('clinic'), getMyClinicAmbulances);
router.put('/update/:id', protect('clinic'), ambulanceDocUploads, updateClinicAmbulance);
router.patch('/toggle-status/:id', protect('clinic'), toggleClinicAmbulanceStatus);
router.delete('/delete/:id', protect('clinic'), deleteClinicAmbulance);

module.exports = router;