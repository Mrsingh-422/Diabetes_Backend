// routes/admin/CGM/CGMRefundAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getAdminRefundQueue,
    processAdminCGMRefund
} = require('../../../controllers/admin/CGM/CGMRefundAdminController');

// Base URL: /admin/cgm/refunds

// 1. Get All Pending / Processed Refunds Queue (Tab 36)
router.get('/queue', protect('admin'), checkRoleAccess(36), getAdminRefundQueue);

// 2. Admin Process 100% Refund Action (Tab 36)
router.post('/process/:id', protect('admin'), checkRoleAccess(36), processAdminCGMRefund);

module.exports = router;