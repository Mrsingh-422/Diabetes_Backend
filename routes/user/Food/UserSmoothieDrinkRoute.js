// routes/user/Food/UserSmoothieDrinkRoute.js

const express = require('express');
const router = express.Router();

const {
    getNearestSmoothieDrinks,
    getSmoothieDrinkDetailsForUser,
} = require('../../../controllers/user/Food/UserSmoothieDrink');

// Base URL: /api/food/drinks

// 1. Get Nearest Geolocated Drinks (Storefront Listing + Filters)
router.post('/nearest', getNearestSmoothieDrinks);

// 2. Get Single Drink Details
router.get('/details/:id', getSmoothieDrinkDetailsForUser);


module.exports = router;