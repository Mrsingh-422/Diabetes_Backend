// routes/user/Food/UserHealthyPlanOrderRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    calculateHealthyPlanBill,
    subscribeHealthyPlanOrder,
    verifyHealthyPlanPayment,
    getMyHealthyPlanOrders,
    getMyHealthyPlanOrderById
} = require('../../../controllers/user/Food/UserHealthyPlanOrder');

// Base URL: /api/food/healthy-plans

// 1. Calculate / Preview Bill
router.post('/calculate', protect('user'), calculateHealthyPlanBill);

// 2. Subscribe / Place Order (COD or Online)
router.post('/subscribe', protect('user'), subscribeHealthyPlanOrder);

// 3. Verify Razorpay Payment
router.post('/verify-payment', protect('user'), verifyHealthyPlanPayment);

// 4. My Orders List & Single Detail
router.get('/my-plans', protect('user'), getMyHealthyPlanOrders);
router.get('/my-plan/:id', protect('user'), getMyHealthyPlanOrderById);

module.exports = router;