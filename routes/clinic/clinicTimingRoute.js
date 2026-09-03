// routes/clinic/clinicTimingRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
    getClinicTimings,
    updateClinicTimings,
    resetClinicTimings,
    getAvailableBookingSlots
} = require('../../controllers/clinic/clinicTimingController');

// Base Route: /api/clinic/timings

// 1. Get Logged-In Clinic's Timings & Bandwidth Summary (for Dashboard UI)
router.get('/', protect('clinic'), getClinicTimings);

// 2. Save & Update Clinic Timings (Matches "SAVE & UPDATE TIMINGS" button)
router.post('/create', protect('clinic'), updateClinicTimings);
router.put('/update', protect('clinic'), updateClinicTimings);

// 3. Reset Timings to default
router.delete('/delete', protect('clinic'), resetClinicTimings);

// 4. Generate discrete OPD booking slots for a given date
router.get('/slots', protect('clinic'), getAvailableBookingSlots);
router.get('/:clinicId/slots', getAvailableBookingSlots); // Public route for User App

module.exports = router;