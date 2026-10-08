// routes/user/CGMDevices/UserDiabetesCoachRoute.js

const express = require('express');
const router = express.Router();

const {
    getNearbyDiabetesCoaches,
    getUserDiabetesCoachById,
    getCoachAvailableSlots
} = require('../../../controllers/user/CGMDevices/UserDiabetesCoach');

// Base URL: /user/cgm/coaches

// 1. POST: Get Coaches with Distance Calculation (Takes userLat, userLng in body)
router.post('/nearby', getNearbyDiabetesCoaches);

// 2. GET: Get Single Coach Full Details by ID
router.get('/get/:id', getUserDiabetesCoachById);

// 3. GET: Get Available Slots for a Selected Date (When user changes date in calendar)
router.get('/slots/:id', getCoachAvailableSlots);

module.exports = router;