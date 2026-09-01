// routes/user/Food/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getNearestVendorMeals,
    getNearestCombos,
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getMealDetailsById,
    getComboDetailsById,
    getUserFoodCategories,
    getUserFoodEffectCategories,
    getFoodCoupons,
    getNearestPlans,             // Geolocated nearest plans
    getPlanDetailsById,          // Single plan full details
    getVendorPlansForUser,
    getAllNearestFoodItems
} = require('../../../controllers/user/Food/FoodPageController');

// Base URL : /api/foodpage

// 🍔 Meals Endpoints
router.post('/nearest-meals', getNearestVendorMeals);
router.get('/meals/:id', getMealDetailsById);

// 🍱 Combo Bundles Endpoints
router.post('/nearest-combos', getNearestCombos);
router.get('/combos/:id', getComboDetailsById);

// 🌟 Tiffin Subscription Plans Endpoints 
// 1. Geolocated Nearest Tiffin Plans (Home Screen)
router.post('/nearest-plans', getNearestPlans);
// 2. Get Single Tiffin Plan Details by ID (Overlay / Details Screen)
router.get('/plans/:id', getPlanDetailsById);
// 3. Specific Vendor Tiffin Plans (Kitchen Profile Screen)
router.get('/vendor-plans/:vendorId', getVendorPlansForUser);

// 📅 Specials & Calendar Endpoints
router.get('/daywise', getFoodPageLayout);
router.get('/daywise/:id', getTodaySpecialById);
router.get('/weekly', getUserWeeklyMenu);
router.get('/weekly/:id', getWeeklySpecialById);

// 🏷️ Categories & Coupons
router.get('/categories', getUserFoodCategories);
router.get('/effects', getUserFoodEffectCategories);
router.get('/coupons', getFoodCoupons);
// 🍲 1. ALL NEAREST FOOD ITEMS (With Search & Pagination)
router.post('/all-foods', getAllNearestFoodItems);

module.exports = router;