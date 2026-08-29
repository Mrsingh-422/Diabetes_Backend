// routes/user/Food/UserTiffinSubscriptionRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    calculateTiffinSubscriptionBill,
    subscribeTiffinPlan,
    modifyTiffinSlotSchedule,
    getMyTiffinSubscriptionDetails
} = require('../../../controllers/user/Food/UserTiffinSubscription');

// Base URL: /api/food/tiffin

// 1. Calculate / Preview Tiffin Subscription Bill (POST)
router.post('/calculate', protect('user'), calculateTiffinSubscriptionBill);

// 2. Subscribe & Purchase Tiffin Plan (POST)
router.post('/subscribe', protect('user'), subscribeTiffinPlan);

// 3. Modify Daily Slot Schedule with 4-Hour Lockout (PUT)
router.put('/schedule/:bookingId', protect('user'), modifyTiffinSlotSchedule);

// 4. Get Active Tiffin Subscription Full Details (GET)
router.get('/my-subscription/:bookingId', protect('user'), getMyTiffinSubscriptionDetails);

module.exports = router;