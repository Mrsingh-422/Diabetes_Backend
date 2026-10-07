// routes/user/CGMDevices/CGMCheckoutRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    calculateCGMBill,
    placeCGMOrder,
    verifyCGMPayment,
    getMyCGMOrders,
    getCGMOrderById
} = require('../../../controllers/user/CGMDevices/CGMCheckoutController');

// Base URL: /api/user/cgm/checkout

// 🧮 1. Calculate Fare / Checkout Preview (Real-time bill calculation)
router.post('/calculate-bill', protect('user'), calculateCGMBill);

// 🛍️ 2. Place Order (COD or Razorpay order creation)
router.post('/place-order', protect('user'), placeCGMOrder);

// 💳 3. Verify Razorpay Payment (Confirm online order)
router.post('/verify-payment', protect('user'), verifyCGMPayment);

// 📋 4. Get My Orders (Lightweight Summary list)
router.get('/my-orders', protect('user'), getMyCGMOrders);

// 🔍 5. Get Single Order Full Details by ID
router.get('/order/:id', protect('user'), getCGMOrderById);



module.exports = router;