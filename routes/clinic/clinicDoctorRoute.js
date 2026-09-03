// routes/clinic/clinicDoctorRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { clinicDoctorUploads } = require('../../middleware/multer');
const {
    addClinicDoctor,
    getMyClinicDoctors,
    updateClinicDoctor, 
    toggleDoctorDutyStatus,
    removeClinicDoctor
} = require('../../controllers/clinic/clinicDoctorController');

// Base Route: /api/clinic/doctors

// 1. Add Doctor (Multi-file upload with protect('clinic'))
router.post('/add', protect('clinic'), clinicDoctorUploads, addClinicDoctor);

// 2. Get all doctors of logged-in clinic
router.get('/my-doctors', protect('clinic'), getMyClinicDoctors);

router.put('/update/:id', protect('clinic'), clinicDoctorUploads, updateClinicDoctor); // New Update Route


// 3. Toggle Doctor Duty Status (On Duty / Off Duty)
router.patch('/:id/duty-status', protect('clinic'), toggleDoctorDutyStatus);

// 4. Remove Doctor
router.delete('/:id', protect('clinic'), removeClinicDoctor);

module.exports = router;