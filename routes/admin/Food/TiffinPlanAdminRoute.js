// routes/admin/Food/TiffinPlanAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    createTiffinPlan,
    getAllTiffinPlans,
    getTiffinPlanById,
    updateTiffinPlan,
    deleteTiffinPlan,
    toggleTiffinPlanStatus
} = require('../../../controllers/admin/Food/TiffinPlanAdminController');

// Base URL: /admin/food/tiffin/plans

// 1. Create Subscription Tier (POST)
router.post('/add', protect('admin'), checkRoleAccess(36), createTiffinPlan);

// 2. Get All Subscription Plans (GET - Public / Dashboard use)
router.get('/get', getAllTiffinPlans);

// 3. Get Single Plan Details (GET)
router.get('/get/:id', getTiffinPlanById);

// 4. Update Plan Details (PUT)
router.put('/update/:id', protect('admin'), checkRoleAccess(36), updateTiffinPlan);

// 5. Delete Plan (DELETE)
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteTiffinPlan);

// 6. Toggle Active Status Switch (PATCH)
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleTiffinPlanStatus);

module.exports = router;