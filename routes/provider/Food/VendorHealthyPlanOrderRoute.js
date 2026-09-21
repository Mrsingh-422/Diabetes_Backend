// routes/provider/Food/VendorHealthyPlanOrderRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getVendorHealthyPlanOrders,
    getVendorHealthyPlanOrderById,
    cancelVendorHealthyPlanOrder
} = require('../../../controllers/provider/Food/VendorHealthyPlanOrder');

// Base URL: /provider/food/healthy-plans

// 1. Get All Orders (Auto-Active List)
router.get('/orders', protect('provider'), getVendorHealthyPlanOrders);

// 2. Get Single Order Full Details
router.get('/orders/:id', protect('provider'), getVendorHealthyPlanOrderById);

// 3. Emergency Cancel with Reason (No Accept/Reject needed)
router.patch('/orders/:id/cancel', protect('provider'), cancelVendorHealthyPlanOrder);

module.exports = router;