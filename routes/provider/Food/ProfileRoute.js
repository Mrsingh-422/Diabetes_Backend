const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

// Multer middleware for handling profile images / documents uploads
// (Note: Ensure karein ki aapne multer middleware me food ke liye proper upload configuration banayi ho)
const { foodDocUploads } = require('../../../middleware/multer'); 

const { 
    getFoodProfile, 
    updateFoodProfile, 
    getLatestFoodProfileRequest, 
    changeFoodPassword 
} = require('../../../controllers/provider/Food/Profile');

// Base URL: /provider/food/profile

router.get('/', protect('food'), getFoodProfile);

router.put('/update', protect('food'), foodDocUploads, updateFoodProfile);

router.get('/update-status', protect('food'), getLatestFoodProfileRequest);

router.patch('/change-password', protect('food'), changeFoodPassword);

module.exports = router;