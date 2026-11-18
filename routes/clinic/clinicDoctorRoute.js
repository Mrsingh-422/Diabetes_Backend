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
    removeClinicDoctor,
    loginClinicDoctor,
    assignAppointmentToClinicDoctor,
    reassignAppointmentToClinicDoctor,
    configureDoctorOpdScheduleByClinic,
    getAvailableClinicDoctors
} = require('../../controllers/clinic/clinicDoctorController');

// Base Route: /api/clinic/doctors

// 0. Clinic Doctor Login (Public)
router.post('/login', loginClinicDoctor);

// 1. Add Doctor (Multi-file upload with protect('clinic'))
router.post('/add', protect('clinic'), clinicDoctorUploads, addClinicDoctor);

// 2. Get all doctors of logged-in clinic
router.get('/my-doctors', protect('clinic'), getMyClinicDoctors);

router.put('/update/:id', protect('clinic'), clinicDoctorUploads, updateClinicDoctor); // New Update Route


// 3. Toggle Doctor Duty Status (On Duty / Off Duty)
router.patch('/:id/duty-status', protect('clinic'), toggleDoctorDutyStatus);

router.get('/available', protect('clinic'), getAvailableClinicDoctors);



// 4. Assign Appointment to Clinic Doctor
router.put('/assign-appointment', protect('clinic'), assignAppointmentToClinicDoctor);
router.put('/reassign-appointment', protect('clinic'), reassignAppointmentToClinicDoctor);

// 5. Configure Doctor OPD Cabin, Fee & Sync Availability
router.put('/configure-opd/:doctorId', protect('clinic'), configureDoctorOpdScheduleByClinic);

// 6. Remove Doctor
router.delete('/:id', protect('clinic'), removeClinicDoctor);

module.exports = router;