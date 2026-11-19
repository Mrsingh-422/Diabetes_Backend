// routes/clinic/clinicDoctorPanelRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById,
    respondToAssignedAppointment
} = require('../../../controllers/clinic/clinicDoctorPannel/clinicDocAppointment');

// Base Route: /api/clinic/doctor-panel

// 1. Get All Assigned Appointments for Logged-in Clinic Doctor (OPD / IPD / Emergency / Handover / Bedside)
router.get('/appointments', protect('clinic-doctor'), getClinicDoctorAppointments);

// 2. Get Single Appointment Full Details by _id or bookingId
router.get('/appointments/:id', protect('clinic-doctor'), getClinicDoctorAppointmentById);
router.get('/appointments/:id/respond', protect('clinic-doctor'), respondToAssignedAppointment); // For doctor to accept/reject the appointment



module.exports = router;