// routes/admin/CGM/CGMOrderAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getAllAdminCGMOrders,
    getAdminCGMOrderById,
    getAllCancelledAdminCGMOrders,
    getAdminCancelledCGMOrderById
} = require('../../../controllers/admin/CGM/CGMOrderAdmin');

// Base URL: /admin/cgm/orders

// 1. Get All Orders for Admin (Table List with Search & Filters)
router.get('/all', protect('admin'), checkRoleAccess(36), getAllAdminCGMOrders);

// 2. Get Single Order Complete Details (For View Modal / Detail Page)
router.get('/detail/:id', protect('admin'), checkRoleAccess(36), getAdminCGMOrderById);

// 3. Get All Cancelled Orders for Admin
router.get('/cancelled', protect('admin'), checkRoleAccess(36), getAllCancelledAdminCGMOrders);

// 4. Get Single Cancelled Order Full Details by ID
router.get('/cancelled/:id', protect('admin'), checkRoleAccess(36), getAdminCancelledCGMOrderById);

module.exports = router;