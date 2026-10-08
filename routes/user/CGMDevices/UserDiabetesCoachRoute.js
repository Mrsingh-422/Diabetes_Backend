// routes/user/CGMDevices/UserDiabetesCoachRoute.js

const express = require('express');
const router = express.Router();

const {
    getNearbyDiabetesCoaches,
    getUserDiabetesCoachById
} = require('../../../controllers/user/CGMDevices/UserDiabetesCoach');

// Base URL: /user/cgm/coaches

// 1. POST: Get Coaches with Distance Calculation (Takes userLat, userLng in body)
router.post('/nearby', getNearbyDiabetesCoaches);

// 2. GET: Get Single Coach Full Details by ID
router.get('/get/:id', getUserDiabetesCoachById);

module.exports = router;