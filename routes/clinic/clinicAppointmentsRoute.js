// routes/clinic/clinicAppointmentsRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { clinicUploads } = require('../../middleware/multer'); // Multer with medicalDocument support

const {
    createClinicAppointmentByClinic,
    getClinicBookings,
    getSingleClinicBookingDetails,
    getClinicDirectBookings,
    getClinicBookingResources,
    getClinicReferredCases,
    getSingleClinicReferredCase,
    confirmAndPayReferredCase,
    getClinicPendingAdmissionHolds,
    collectClinicAdmissionCounterPayment,
    switchClinicHeldBedAtCounter
} = require('../../controllers/clinic/clinicAppointments');

// Base URL: /api/clinic/booking

// 1. Create Appointment/Admission from Clinic Desk (With Multer for medicalDocument/Prescription)
router.post('/create', protect('clinic'), clinicUploads, createClinicAppointmentByClinic);

router.get('/direct-bookings', protect('clinic'), getClinicDirectBookings);

router.get('/resources', protect('clinic'), getClinicBookingResources);

// 2. Get All Clinic Bookings (Paginated & Filtered by OPD/IPD/Emergency)
router.get('/all-bookings', protect('clinic'), getClinicBookings);

// 3. Get Single Booking Full Details by ID or bookingId
router.get('/booking/:bookingId', protect('clinic'), getSingleClinicBookingDetails);

// Referred Cases Desk
router.get('/referred-cases', protect('clinic'), getClinicReferredCases);
router.get('/referred-cases/:referralId', protect('clinic'), getSingleClinicReferredCase);
router.post('/referred-cases/:referralId/confirm-and-pay', protect('clinic'), confirmAndPayReferredCase);

// IPD Admission Bed Holds Desk
router.get('/admissions/pending-holds', protect('clinic'), getClinicPendingAdmissionHolds);
router.patch('/admission/collect-payment/:id', protect('clinic'), collectClinicAdmissionCounterPayment);
router.patch('/admission/switch-bed/:id', protect('clinic'), switchClinicHeldBedAtCounter);

module.exports = router;