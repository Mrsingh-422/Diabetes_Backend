// routes/admin/CGM/CGMCoachChargeAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    createCoachCharge,
    getCoachCharges,
    getCoachChargeById,
    updateCoachCharge,
    deleteCoachCharge,
    toggleCoachChargeActive
} = require('../../../controllers/admin/CGM/CGMCoachChargeController');

// Base URL: /admin/cgm/coach-charge

// Pure JSON Endpoints (No Multer)
router.post('/add', protect('admin'), checkRoleAccess(36), createCoachCharge);
router.put('/update/:id', protect('admin'), checkRoleAccess(36), updateCoachCharge);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteCoachCharge);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleCoachChargeActive);

// User & Admin Get APIs
router.get('/get', getCoachCharges);
router.get('/get/:id', getCoachChargeById);

module.exports = router;