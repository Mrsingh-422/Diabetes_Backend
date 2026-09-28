// routes/admin/Clinic/adminClinicAppointmentsRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    getApprovedClinicsList,
    getClinicAppointmentsModal,
    getAllCancelledClinicAppointments
} = require('../../../controllers/admin/Clinic/AdminClinicAppointments');

// Base Route: /api/admin/clinic-appointments

// 1. Screen 1: Approved Clinics list with Total & Active appointments counts
router.get('/clinics', protect('admin'), getApprovedClinicsList);

// 2. Screen 2: All appointments under a specific Clinic (On Click)
router.get('/:clinicId/appointments', protect('admin'), getClinicAppointmentsModal);

// 3. Cancelled Clinic Appointments List
router.get('/cancelled-appointments', protect('admin'), getAllCancelledClinicAppointments);

module.exports = router;