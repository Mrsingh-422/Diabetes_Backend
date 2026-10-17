// routes/admin/CGM/DiabeticCoachBookingRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getAdminCancelledCoachBookings,
    getAdminCoachesWithBookingStats,
    getAdminBookingsByCoachId,
    getAdminCoachBookingDetailById
} = require('../../../controllers/admin/CGM/DiabeticCoachBookings');

// Base URL: /admin/cgm/coach-bookings
// Tab ID: 36 (Manage Catalog & Orders)

// 🚫 1. Get All Cancelled Coach Bookings
router.get('/cancelled', protect('admin'), checkRoleAccess(36), getAdminCancelledCoachBookings);

// 👨‍⚕️ 2. Get All Coaches with Booking Stats (Step 1)
router.get('/coaches', protect('admin'), checkRoleAccess(36), getAdminCoachesWithBookingStats);

// 📋 3. Get All Bookings of a Specific Coach (Step 2)
router.get('/coach/:coachId/bookings', protect('admin'), checkRoleAccess(36), getAdminBookingsByCoachId);

// 🔍 4. Get Single Booking Full Details by ID (Step 3)
router.get('/booking/:id', protect('admin'), checkRoleAccess(36), getAdminCoachBookingDetailById);

module.exports = router;