// routes/provider/Food/FoodOrderRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getVendorOrders,
    getVendorOrderById,
    updateVendorOrderStatus
} = require('../../../controllers/provider/Food/FoodOrderController');

// Base URL: /provider/food/orders

// 1. Get All Kitchen Orders (Filtered & Paginated)
router.get('/my-orders', protect('provider'), getVendorOrders);

// 2. Get Single Order Details By ID (MongoDB _id or bookingId)
router.get('/:id', protect('provider'), getVendorOrderById);

// 3. Update Kitchen Order Status (New -> Preparing -> Ready)
router.patch('/:id/status', protect('provider'), updateVendorOrderStatus);

module.exports = router;