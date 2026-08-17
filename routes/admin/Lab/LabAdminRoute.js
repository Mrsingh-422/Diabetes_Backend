// routes/admin/Lab/LabAdmin.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
   
   toggleActiveInactiveLab,
   adminGetLabBookings,
   adminGetApprovedLabs
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

// List & Bookings Directory
router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedLabs);
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetLabBookings);


// Toggle account activation / deactivation
router.patch('/toggle-active/:labId', protect('admin'), checkRoleAccess(5), toggleActiveInactiveLab);

module.exports = router;