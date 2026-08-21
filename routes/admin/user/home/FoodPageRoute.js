// routes/admin/user/home/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getVendorMenuForUser,
    getVendorMenuItemById,
    getVendorComboById,
    getVendorCombosForUser
} = require('../../../../controllers/admin/user/Home/FoodPageController');

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



// --- 3. DYNAMIC VENDOR MENU LIST & DETAIL APIS ---
// Full Path: GET /api/foodpage/vendor-menu/:vendorId
router.get('/vendor-menu/:vendorId', getVendorMenuForUser);

// Full Path: GET /api/foodpage/vendor-menu/:vendorId/:id
router.get('/vendor-menu/:vendorId/:id', getVendorMenuItemById);

// --- 4. DYNAMIC VENDOR COMBOS LIST & DETAIL APIS ---
// Full Path: GET /api/foodpage/vendor-combos/:vendorId
router.get('/vendor-combos/:vendorId', getVendorCombosForUser);

// Full Path: GET /api/foodpage/vendor-combos/:vendorId/:id
router.get('/vendor-combos/:vendorId/:id', getVendorComboById);


module.exports = router;