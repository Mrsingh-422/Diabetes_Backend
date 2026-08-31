// routes/user/Food/UserTiffinRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    calculateTiffinSubscriptionBill,
    subscribeTiffinPlan,
    modifyTiffinSlotSchedule,
    getMyTiffinSubscriptionDetails,
    getAllMyTiffinSubscriptions
} = require('../../../controllers/user/Food/UserTiffinSubscription');

// Base URL: /api/food/tiffin

// 1. Direct Tiffin Bill Calculate (POST)
router.post('/calculate', protect('user'), calculateTiffinSubscriptionBill);

// 2. Direct Subscribe & Buy Tiffin Plan (POST)
router.post('/subscribe', protect('user'), subscribeTiffinPlan);

// 3. Modify Schedule with 4-Hour Lockout (PUT)
router.put('/schedule/:bookingId', protect('user'), modifyTiffinSlotSchedule);

// 4. 🌟 Get All My Subscriptions List (GET) - Placed above dynamic ID
router.get('/my-subscriptions', protect('user'), getAllMyTiffinSubscriptions);

// 4. Get Subscription Details (GET)
router.get('/my-subscription/:bookingId', protect('user'), getMyTiffinSubscriptionDetails);

module.exports = router;