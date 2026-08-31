// routes/user/Food/CustomTiffinRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getCustomTiffinMenuConfig,
    calculateCustomTiffinBill,
    createCustomTiffinOrder,
    getMyCustomTiffinDetails
} = require('../../../controllers/user/Food/CustomTiffinController');

// Base URL: /api/food/custom-tiffin

// 1. Get Live Menu Config for Frontend Builder Tabs (Public/User)
router.get('/menu-config', getCustomTiffinMenuConfig);

// 2. Direct Calculate / Preview Bill for Custom Days Package (POST)
router.post('/calculate', protect('user'), calculateCustomTiffinBill);

// 3. Direct Create & Buy Custom Tiffin Package (POST)
router.post('/create', protect('user'), createCustomTiffinOrder);

// 4. Get Single Custom Plan Full Details by ID (GET)
router.get('/my-custom-plan/:bookingId', protect('user'), getMyCustomTiffinDetails);

module.exports = router;