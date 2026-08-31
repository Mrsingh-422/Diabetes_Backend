// routes/provider/Food/VendorTiffinOrderRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getVendorTiffinSubscriptions,
    getVendorTiffinSubscriptionById,
    getVendorCustomTiffinRequests,
    getVendorCustomTiffinRequestById,
    handleCustomTiffinRequestAction
} = require('../../../controllers/provider/Food/VendorTiffinOrderController');

// Base URL: /provider/food/tiffin

// 🍱 1. Standard Tiffin Subscriptions
router.get('/subscriptions', protect('provider'), getVendorTiffinSubscriptions);
router.get('/subscriptions/:id', protect('provider'), getVendorTiffinSubscriptionById);

// 🎨 2. Custom Tiffin Requests
router.get('/custom-requests', protect('provider'), getVendorCustomTiffinRequests);
router.get('/custom-requests/:id', protect('provider'), getVendorCustomTiffinRequestById);
router.patch('/custom-requests/:id/action', protect('provider'), handleCustomTiffinRequestAction);

module.exports = router;