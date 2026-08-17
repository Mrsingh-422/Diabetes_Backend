// routes/admin/Food/foodAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
   
    getApprovedFoodsList,
    toggleFoodActiveStatus
} = require('../../../controllers/admin/Food/foodAdmin');

// Base URL: /admin/food

// --- FOOD REGISTERED/APPROVED MGMT (ID: 30) ---
// Get Approved Food Partners list
router.get('/approved', protect('admin'), checkRoleAccess(30), getApprovedFoodsList);

// Toggle food partner active/inactive state
router.patch('/toggle-active/:id', protect('admin'), checkRoleAccess(30), toggleFoodActiveStatus);

module.exports = router;