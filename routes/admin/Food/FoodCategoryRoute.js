// routes/admin/Food/foodAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const {
    createFoodCategory,
    getFoodCategories,
    updateFoodCategory,
    deleteFoodCategory
} = require('../../../controllers/admin/Food/FoodCategory');

// Base URL: /admin/food/category

// ==========================================
// 🔴 FOOD CATEGORIES MANAGEMENT (Left Directory Panel)
// ==========================================

// 1. Add Category (Figma/Dashboard Left panel - Add Button)
// Full Path: POST /admin/food/category/add
router.post('/add', protect('admin'), checkRoleAccess(36), createFoodCategory);

// 2. Rename Category (Figma/Dashboard Left panel - Edit Icon)
// Full Path: PUT /admin/food/category/update/:id
router.put('/update/:id', protect('admin'), checkRoleAccess(36), updateFoodCategory);

// 3. Delete Category (Figma/Dashboard Left panel - Delete Icon)
// Full Path: DELETE /admin/food/category/delete/:id
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteFoodCategory);


// ==========================================
// 🟢 PUBLIC ACCESS CATEGORIES APIS
// ==========================================

// 4. Retrieve list of active categories (To show on UI sliders)
// Full Path: GET /admin/food/category/get
router.get('/get', getFoodCategories);

module.exports = router;


