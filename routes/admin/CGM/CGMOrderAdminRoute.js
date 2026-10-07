// routes/admin/CGM/CGMOrderAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getAllAdminCGMOrders,
    getAdminCGMOrderById
} = require('../../../controllers/admin/CGM/CGMOrderAdmin');

// Base URL: /admin/cgm/orders

// 1. Get All Orders for Admin (Table List with Search & Filters)
router.get('/all', protect('admin'), checkRoleAccess(36), getAllAdminCGMOrders);

// 2. Get Single Order Complete Details (For View Modal / Detail Page)
router.get('/detail/:id', protect('admin'), checkRoleAccess(36), getAdminCGMOrderById);

module.exports = router;