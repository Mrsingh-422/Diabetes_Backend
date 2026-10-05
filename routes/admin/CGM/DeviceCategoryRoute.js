const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const {
    createDeviceCategory,
    getDeviceCategories,
    updateDeviceCategory,
    deleteDeviceCategory,
    toggleCategoryStatus
} = require('../../../controllers/admin/CGM/DeviceCategoryController');

// Base URL: /admin/cgm/category

router.post('/add', protect('admin'), checkRoleAccess(36), createDeviceCategory);
router.get('/get', getDeviceCategories); // Public/Dashboard dropdown
router.put('/update/:id', protect('admin'), checkRoleAccess(36), updateDeviceCategory);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteDeviceCategory);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleCategoryStatus);

module.exports = router;