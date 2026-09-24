// routes/admin/Food/SmoothieDrinkAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { smoothieDrinkUploads } = require('../../../middleware/multer');

const {
    createSmoothieDrink,
    getAllSmoothieDrinks,
    getSmoothieDrinkById,
    updateSmoothieDrink,
    deleteSmoothieDrink,
    toggleSmoothieDrinkStatus
} = require('../../../controllers/admin/Food/SmoothieDrinkAdminController');

// Base URL: /admin/food/drinks


// Tab ID: 36 (Manage Foods)

// 1. Create Smoothie / Drink (Multiple Images)
router.post('/add', protect('admin'), checkRoleAccess(36), smoothieDrinkUploads, createSmoothieDrink);

// 2. Get All Drinks (With Search, Pagination & Filters)
router.get('/get', getAllSmoothieDrinks);

// 3. Get Single Drink by ID
router.get('/get/:id', getSmoothieDrinkById);

// 4. Update Drink
router.put('/update/:id', protect('admin'), checkRoleAccess(36), smoothieDrinkUploads, updateSmoothieDrink);

// 5. Delete Drink
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteSmoothieDrink);

// 6. Toggle Active Status Switch
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleSmoothieDrinkStatus);

module.exports = router;