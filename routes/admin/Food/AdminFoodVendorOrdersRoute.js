// routes/admin/Food/AdminFoodVendorOrdersRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getApprovedFoodOutletsList,
    getVendorOrderHistoryModal,
    getAllCancelledFoodOrders
} = require('../../../controllers/admin/Food/AdminFoodVendorOrders');

// Base URL: /admin/food/vendor-orders


// Tab ID: 35 (Vendors / Food Outlets) & Tab 36 (Manage Foods)

// 1. Get Approved Food Outlets List (Screen 1 Table)
router.get('/outlets', protect('admin'), checkRoleAccess(35), getApprovedFoodOutletsList);

// 2. Get Outlet Order History & Associated Orders (Screen 2 Modal)
router.get('/:vendorId/orders', protect('admin'), checkRoleAccess(35), getVendorOrderHistoryModal);

// 🚫 Get All Cancelled Food Orders (All Booking Types)
router.get('/cancelled-orders', protect('admin'), checkRoleAccess(35), getAllCancelledFoodOrders);

module.exports = router;