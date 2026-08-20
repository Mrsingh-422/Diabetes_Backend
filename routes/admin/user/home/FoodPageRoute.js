// routes/admin/user/home/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById
} = require('../../../../controllers/admin/user/Home/FoodPageController');
const { getVendorCombosForUser } = require('../../../../controllers/provider/Food/FoodInventoryController');

// Base URL : /api/foodpage

// --- 1. TODAY'S SPECIALS APIS ---
// Get paginated list of Today's Specials (Default Limit: 20)
router.get('/daywise', getFoodPageLayout);

// Get single Today's Special meal details
router.get('/daywise/:id', getTodaySpecialById);


// --- 2. WEEKLY PLANNERS APIS ---
// Get weekly calendar structure
router.get('/weekly', getUserWeeklyMenu);

// Get single Weekly menu plan meal details
router.get('/weekly/:id', getWeeklySpecialById);
// Full Path: GET /api/foodpage/vendor-combos/:vendorId
// User app par Specific kitchen vendor click hone par combo lists load karne ke liye
router.get('/vendor-combos/:vendorId', getVendorCombosForUser);

module.exports = router;