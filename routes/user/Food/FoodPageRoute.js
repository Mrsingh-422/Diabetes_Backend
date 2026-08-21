// routes/user/Food/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getNearestVendors, //  New Import
    getNearestCombos,  //  New Import
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById
} = require('../../../controllers/user/Food/FoodPageController');

// Base URL : /api/foodpage

// 🚨 NEW GEOLOCATED VENDORS API (POST endpoint retrieving dynamic proximity data) [37]
// Full Path: POST /api/foodpage/nearest-vendors
router.post('/nearest-vendors', getNearestVendors);

// 🚨 NEW GEOLOCATED COMBO BUNDLES LIST (Fires near-by tiffin bundles directly) [37, 53]
// Full Path: POST /api/foodpage/nearest-combos
router.post('/nearest-combos', getNearestCombos);

// Today's Specials
router.get('/daywise', getFoodPageLayout);
router.get('/daywise/:id', getTodaySpecialById);

// Weekly Calendar
router.get('/weekly', getUserWeeklyMenu);
router.get('/weekly/:id', getWeeklySpecialById);

module.exports = router;