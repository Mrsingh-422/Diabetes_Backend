// routes/ambulance/ambulanceStaffRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {
    getAmbulanceStaff,
    updateAmbulanceStaff,
    deleteAmbulanceStaff
} = require('../../controllers/ambulance/ambulanceStaffController');

// base URL: /api/ambulance/staff

const allowedRoles = ['admin', 'clinic', 'ambulance', ];

// 1. Get Assigned Staff of an Ambulance
router.get('/:ambulanceId', protect(allowedRoles), getAmbulanceStaff);

// 2. Assign / Update Staff on an Ambulance (Multi-role protected)
router.put('/:ambulanceId', protect(allowedRoles), updateAmbulanceStaff);

// routes/ambulance/ambulanceStaffRoute.js me add karein:
router.delete('/:ambulanceId/:staffId', protect(allowedRoles), deleteAmbulanceStaff);

module.exports = router;