// routes/admin/Food/foodAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    getApprovedFoodsList,
    toggleFoodActiveStatus,
    createFoodService,
    updateFoodService,
    deleteFoodService,
    getFoodServicesList,
    getFoodServiceById
} = require('../../../controllers/admin/Food/foodAdmin');

// Base URL: /admin/food

// ==========================================
// 🔴 VENDOR PROFILES CONFIGURATION (Tab ID: 35)
// ==========================================

// Get Approved Food Partners list
router.get('/approved', protect('admin'), checkRoleAccess(35), getApprovedFoodsList);

// Toggle food partner active/inactive state
router.patch('/toggle-active/:id', protect('admin'), checkRoleAccess(35), toggleFoodActiveStatus);


// ==========================================
// 🔴 MASTER CATALOG SERVICES (Tab ID: 36)
// ==========================================

// 1. Create a food item inside master catalog
router.post('/create/services', protect('admin'), checkRoleAccess(36), createFoodService);

// 2. Update food service details
router.put('/update/services/:id', protect('admin'), checkRoleAccess(36), updateFoodService);

// 3. Deactivate / soft delete food item
router.delete('/delete/services/:id', protect('admin'), checkRoleAccess(36), deleteFoodService);


// ==========================================
// 🟢 PUBLIC ACCESS CATALOG GET APIS
// ==========================================

// 4. Retrieve paginated list of all active catalog foods (Public or Dashboard use)
router.get('/get/services', getFoodServicesList);

// 5. Get detailed specifications overlay details for a single meal
router.get('/get/services/:id', getFoodServiceById);

module.exports = router;