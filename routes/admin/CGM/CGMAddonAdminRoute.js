// routes/admin/CGM/CGMAddonAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { cgmAddonImageUpload } = require('../../../middleware/multer');

const {
    createCGMAddon,
    getCGMAddons,
    getCGMAddonById,
    updateCGMAddon,
    deleteCGMAddon,
    toggleCGMAddonActive
} = require('../../../controllers/admin/CGM/CGMAddonController');

// Base URL: /admin/cgm/addons

// Tab ID: 36 (Catalog Management)
router.post('/add', protect('admin'), checkRoleAccess(36), cgmAddonImageUpload, createCGMAddon);
router.put('/update/:id', protect('admin'), checkRoleAccess(36), cgmAddonImageUpload, updateCGMAddon);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteCGMAddon);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleCGMAddonActive);

// Public / User access for checkout screen
router.get('/get', getCGMAddons);
router.get('/get/:id', getCGMAddonById);

module.exports = router;