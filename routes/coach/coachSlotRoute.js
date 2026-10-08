// routes/coach/coachSlotRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {
    setMySlotConfig,
    getMySlotConfig
} = require('../../controllers/coach/coachSlotController');

// Base URL: /api/coach/slots

// Coach Protected Endpoints (Uses Coach's Bearer JWT Token)
router.put('/my-slots', protect(['coach', 'diabetes-coach']), setMySlotConfig);
router.get('/my-slots', protect(['coach', 'diabetes-coach']), getMySlotConfig);

module.exports = router;