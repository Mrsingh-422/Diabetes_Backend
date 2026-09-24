// routes/provider/Food/VendorSmoothieDrinkRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    getMasterSmoothieDrinksForSelection,
    syncSmoothieDrinks,
    toggleSmoothieDrinkAvailability,
    getVendorSmoothieDrinks,
    getVendorSmoothieDrinkById
} = require('../../../controllers/provider/Food/VendorSmoothieDrinkController');

// Base URL: /provider/food/drinks

// 1. Master Checklist for Selection
router.get('/master-catalog', protect('provider'), getMasterSmoothieDrinksForSelection);

// 2. Multi-Sync Drinks & Custom Pricing
router.post('/sync', protect('provider'), syncSmoothieDrinks);

// 3. Instant Toggle Availability Switch
router.patch('/toggle/:drinkId', protect('provider'), toggleSmoothieDrinkAvailability);

// 4. Get Vendor Inventory Drinks List
router.get('/my-drinks', protect('provider'), getVendorSmoothieDrinks);

// 5. Get Single Vendor Drink Full Details
router.get('/:drinkId', protect('provider'), getVendorSmoothieDrinkById);

module.exports = router;