// routes/admin/Food/PeakOrderChargeAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getPeakOrderCharges,
    savePeakOrderCharges,
    toggleSlotPeakChargeStatus
} = require('../../../controllers/admin/Food/PeakOrderChargeAdmin');

// Base URL: /admin/food/peak-charges

// 1. Get Current Peak Charges Config (GET)
router.get('/', protect('admin'), getPeakOrderCharges);

// 2. Save / Update Slot Charges & Status (POST / PUT)
router.post('/save', protect('admin'), checkRoleAccess(36), savePeakOrderCharges);
router.put('/update', protect('admin'), checkRoleAccess(36), savePeakOrderCharges);

// 3. Instant Toggle Specific Slot Status (PATCH)
router.patch('/toggle-slot/:slotName', protect('admin'), checkRoleAccess(36), toggleSlotPeakChargeStatus);

module.exports = router;