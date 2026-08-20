// routes/admin/user/home/FoodPageRoute.js

const express = require('express');
const router = express.Router();

const { 
    getFoodPageLayout,
    getUserWeeklyMenu
} = require('../../../../controllers/admin/user/Home/FoodPageController');

// Base URL : /api/foodpage

// 1. Get complete dynamic home page categories & recommendations carousel layout
router.get('/daywise', getFoodPageLayout);

// 2. Get tiffin subscription weekly planner calendar templates
router.get('/weekly', getUserWeeklyMenu);

module.exports = router;