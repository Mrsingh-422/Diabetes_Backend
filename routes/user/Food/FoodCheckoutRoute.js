// routes/user/Food/FoodCheckoutRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware')
const { foodAddonImageUpload } = require('../../../middleware/multer');
;

const {
    calculateCheckoutBill,
    placeFoodOrder,
    verifyFoodPayment,
    getMyFoodOrders,
    getSingleFoodOrder,
    createFoodAddon,
    getAvailableAddons,
    getAddonById,
    updateFoodAddon,
    deleteFoodAddon,
    toggleAddonStatus
} = require('../../../controllers/user/Food/FoodCheckoutController');

// Base URL: /api/food/checkout

// 1. Calculate / Preview Bill Breakdown (POST)
router.post('/calculate', protect('user'), calculateCheckoutBill);

// 2. Unified Place Order (COD or Online Initiation) (POST)
router.post('/place-order', protect('user'), placeFoodOrder);

// 3. Verify Razorpay Payment (POST)
router.post('/verify-payment', protect('user'), verifyFoodPayment);

// 4. Order History (GET)
router.get('/my-orders', protect('user'), getMyFoodOrders);

// 5. Single Order Tracking (GET)
router.get('/order/:id', protect('user'), getSingleFoodOrder);

// ==========================================
// 🥗 ADD-ONS ROUTES
// ==========================================
router.get('/addons', getAvailableAddons); // Public
router.get('/addons/:id', getAddonById);
router.post('/addons/add', protect('admin'), foodAddonImageUpload, createFoodAddon);
router.put('/addons/update/:id', protect('admin'), foodAddonImageUpload, updateFoodAddon);
router.delete('/addons/delete/:id', protect('admin'), deleteFoodAddon);
module.exports = router;