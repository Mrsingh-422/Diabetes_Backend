// routes/admin/Lab/LabAdmin.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
   
   toggleActiveInactiveLab,
   adminGetLabBookings,
   adminGetLabBookingDetails,
   adminGetLabsSortedByOrders,
   adminGetApprovedLabs
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

// 1. Get Labs sorted by highest total orders first (Decreasing order)
router.get('/vendors-by-orders', protect('admin'), checkRoleAccess(5), adminGetLabsSortedByOrders);

// 2. Get Bookings for a clicked vendor (supports ?labId=...&page=1)
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetLabBookings);

// 3. Get Full Details when admin clicks on a specific booking
router.get('/bookings/details/:orderId', protect('admin'), checkRoleAccess(5), adminGetLabBookingDetails);

// List & Bookings Directory
router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedLabs);


// Toggle account activation / deactivation
router.patch('/toggle-active/:labId', protect('admin'), checkRoleAccess(5), toggleActiveInactiveLab);

module.exports = router;