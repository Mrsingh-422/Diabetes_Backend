// routes/admin/Food/FoodHealthyPlansAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { foodHealthyPlanUploads } = require('../../../middleware/multer');

const {
    createOrUpdateHealthyCategory,
    getHealthyCategories,
    removeHealthySubCategory,
    deleteHealthyMainCategory,
    createHealthyPlan,
    getAllHealthyPlans,
    getHealthyPlanById,
    updateHealthyPlan,
    deleteHealthyPlan,
    toggleHealthyPlanStatus,
    updateHealthyCategory
} = require('../../../controllers/admin/Food/FoodHealthyPlansAdmin');

// Base URL: /admin/food/healthy-plans

// ==========================================
// 🏷️ 1. CATEGORIES MANAGEMENT (Tab ID: 36)
// ==========================================
router.post('/categories/add', protect('admin'), checkRoleAccess(36), createOrUpdateHealthyCategory);
router.get('/categories/get', getHealthyCategories); // Public/Dashboard use
router.put('/categories/update/:id', protect('admin'), checkRoleAccess(36), updateHealthyCategory);
router.delete('/categories/:mainCategoryId/sub/:subCategoryName', protect('admin'), checkRoleAccess(36), removeHealthySubCategory);
router.delete('/categories/:id', protect('admin'), checkRoleAccess(36), deleteHealthyMainCategory);


// ==========================================
// 🥗 2. HEALTHY PLANS CRUD (Tab ID: 36)
// ==========================================
router.post('/add', protect('admin'), checkRoleAccess(36), foodHealthyPlanUploads, createHealthyPlan);
router.get('/get', getAllHealthyPlans); // List View
router.get('/get/:id', getHealthyPlanById); // Detailed Card View
router.put('/update/:id', protect('admin'), checkRoleAccess(36), foodHealthyPlanUploads, updateHealthyPlan);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteHealthyPlan);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleHealthyPlanStatus);

module.exports = router;