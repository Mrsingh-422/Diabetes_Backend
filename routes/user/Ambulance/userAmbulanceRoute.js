// routes/user/Ambulance/userAmbulanceRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getNearbyAmbulances,
    getAmbulanceDetailsForUser,
    getClinicAmbulanceSlotsForUser,
    getAmbulanceCouponsForUser
} = require('../../../controllers/user/Ambulance/userAmbulanceController');

// Base Route: /api/user/ambulance

// 1. POST API for Nearest Ambulances with User Lat/Lng
router.post('/nearest', getNearbyAmbulances);

// 2. Get Single Ambulance Details by ID
router.get('/details/:id', getAmbulanceDetailsForUser);

//  3. Get Time Slots for Clinic-Ambulance (Returns notice if Independent)
router.get('/slots/:ambulanceId', getClinicAmbulanceSlotsForUser);

router.get('/coupons/:ambulanceId',protect('user'),getAmbulanceCouponsForUser);


module.exports = router;