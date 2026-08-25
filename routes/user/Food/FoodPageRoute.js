// routes/user/Food/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getNearestVendorMeals, //  New Import
    getNearestCombos,  //  New Import
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getMealDetailsById,
    getComboDetailsById,
    getUserFoodCategories,
    getUserFoodEffectCategories,
    getFoodCoupons
} = require('../../../controllers/user/Food/FoodPageController');

// Base URL : /api/foodpage

// Full Path: POST /api/foodpage/nearest-meals
router.post('/nearest-meals', getNearestVendorMeals);
// Full Path: GET /api/foodpage/meals/:id
router.get('/meals/:id', getMealDetailsById);

// Full Path: GET /api/foodpage/combos/:id
router.get('/combos/:id', getComboDetailsById);

// 🚨 NEW GEOLOCATED COMBO BUNDLES LIST (Fires near-by tiffin bundles directly) [37, 53]
// Full Path: POST /api/foodpage/nearest-combos
router.post('/nearest-combos', getNearestCombos);

// Today's Specials
router.get('/daywise', getFoodPageLayout);
router.get('/daywise/:id', getTodaySpecialById);

// Weekly Calendar
router.get('/weekly', getUserWeeklyMenu);
router.get('/weekly/:id', getWeeklySpecialById);
// A. Get only Food Categories (For horizontal sliders)
// Full Path: GET /api/foodpage/categories
router.get('/categories', getUserFoodCategories);

// B. Get only Therapy/Health Effect Focus Categories (For medical filters)
// Full Path: GET /api/foodpage/effects
router.get('/effects', getUserFoodEffectCategories);

// 🎟️ Get Active Food Coupons (Public / Checkout use)
// Full Path: GET /api/foodpage/coupons
router.get('/coupons', getFoodCoupons);

module.exports = router;