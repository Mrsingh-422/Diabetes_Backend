// routes/admin/Doctor/adminDoctorAppointmentsRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    getApprovedIndependentDoctorsList,
    getDoctorAppointmentsModal,
    getAllCancelledDoctorAppointments
} = require('../../../controllers/admin/Doctor/AdminDoctorAppointments');

// Base Route: /api/admin/doctor-appointments

// 1. Screen 1: Approved Independent Doctors list with Total & Active appointments counts
router.get('/doctors', protect('admin'), getApprovedIndependentDoctorsList);

// 2. Screen 2: All appointments of a specific Doctor (On Click)
router.get('/:doctorId/appointments', protect('admin'), getDoctorAppointmentsModal);

// 3. Cancelled Doctor Appointments List
router.get('/cancelled-appointments', protect('admin'), getAllCancelledDoctorAppointments);

module.exports = router;