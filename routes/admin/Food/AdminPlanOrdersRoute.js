// routes/admin/Food/AdminPlanOrdersRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
         
    getHealthyPlanSubscribedUsers,

    // 🥗 Healthy Plans
    getAdminHealthyPlanOrdersList,
    getAdminHealthyPlanOrderById,

    // 🍱 Standard Subscriptions
    getAdminSubscriptionOrdersList,
    getAdminSubscriptionOrderById,

    // 🎨 Custom Plates
    getAdminCustomPlateOrdersList,
    getAdminCustomPlateOrderById
} = require('../../../controllers/admin/Food/AdminPlanOrders');

// Base URL: /admin/food/plan-orders
// Tab ID: 36 (Manage Foods)

router.get('/healthy-plans/:planId/subscribers', protect('admin'), checkRoleAccess(36), getHealthyPlanSubscribedUsers);

// ==========================================
// 🥗 1. HEALTHY PLANS (PLANS LIST & PLAN DETAILS WITH USERS LIST)
// ==========================================
router.get('/healthy-plans', protect('admin'), checkRoleAccess(36), getAdminHealthyPlanOrdersList);
router.get('/healthy-plans/:id', protect('admin'), checkRoleAccess(36), getAdminHealthyPlanOrderById);

// ==========================================
// 🍱 2. STANDARD SUBSCRIPTIONS (PLANS LIST & PLAN DETAILS WITH USERS LIST)
// ==========================================
router.get('/subscriptions', protect('admin'), checkRoleAccess(36), getAdminSubscriptionOrdersList);
router.get('/subscriptions/:id', protect('admin'), checkRoleAccess(36), getAdminSubscriptionOrderById);

// ==========================================
// 🎨 3. CUSTOM PLATES (ORDERS LIST & ORDER DETAILS)
// ==========================================
router.get('/custom-plates', protect('admin'), checkRoleAccess(36), getAdminCustomPlateOrdersList);
router.get('/custom-plates/:id', protect('admin'), checkRoleAccess(36), getAdminCustomPlateOrderById);

module.exports = router;