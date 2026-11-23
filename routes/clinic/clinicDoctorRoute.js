// routes/clinic/clinicDoctorRoute.js
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
    getAvailableClinicDoctors,
    getDoctorOpdSettingsByClinic,
    toggleDoctorOpdSlotBlockByClinic,
    getClinicDoctorLeaves,
    respondToDoctorLeaveByClinic
} = require('../../controllers/clinic/clinicDoctorController');

// Base Route: /api/clinic/doctors

// 0. Clinic Doctor Login (Public)
router.post('/login', loginClinicDoctor);

// 1. Doctor CRUD & Directory
router.post('/add', protect('clinic'), clinicDoctorUploads, addClinicDoctor);
router.get('/my-doctors', protect('clinic'), getMyClinicDoctors);
router.get('/available', protect('clinic'), getAvailableClinicDoctors);
router.put('/update/:id', protect('clinic'), clinicDoctorUploads, updateClinicDoctor);

// 2. OPD Governance, Cabin, Weekly Roster & Time Slots (Clinic Panel)
router.get('/opd-settings/:doctorId', protect('clinic'), getDoctorOpdSettingsByClinic);
router.put('/configure-opd/:doctorId', protect('clinic'), configureDoctorOpdScheduleByClinic);
router.post('/opd-slots/toggle-block/:doctorId', protect('clinic'), toggleDoctorOpdSlotBlockByClinic);

// 3. Doctor Leave Governance (Clinic Panel)
router.get('/leaves', protect('clinic'), getClinicDoctorLeaves);
router.get('/leaves/:doctorId', protect('clinic'), getClinicDoctorLeaves);
router.patch('/leaves/respond', protect('clinic'), respondToDoctorLeaveByClinic);

// 4. Appointment Assignment & Duty Status
router.put('/assign-appointment', protect('clinic'), assignAppointmentToClinicDoctor);
router.put('/reassign-appointment', protect('clinic'), reassignAppointmentToClinicDoctor);
router.patch('/:id/duty-status', protect('clinic'), toggleDoctorDutyStatus);

// 5. Remove Doctor
router.delete('/:id', protect('clinic'), removeClinicDoctor);

module.exports = router;