// routes/clinic/clinicDoctorPannel/clinicDocAppointmentRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById,
    respondToAssignedAppointment
} = require('../../../controllers/clinic/clinicDoctorPannel/clinicDocAppointment');

// Base Route: /api/clinic/doctor-panel

// --- APPOINTMENTS ---
router.get('/appointments', protect('clinic-doctor'), getClinicDoctorAppointments);

// Accept or Reject (with reason) assigned appointment
router.patch('/appointments/respond', protect('clinic-doctor'), respondToAssignedAppointment);
router.patch('/appointments/:id/respond', protect('clinic-doctor'), respondToAssignedAppointment);

// Get Single Appointment Full Details by _id or bookingId
router.get('/appointments/:id', protect('clinic-doctor'), getClinicDoctorAppointmentById);

module.exports = router;