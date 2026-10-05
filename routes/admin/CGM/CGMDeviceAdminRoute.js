const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { cgmDeviceUploads, uploadExcel } = require('../../../middleware/multer'); // 👈 Imported uploadExcel

const {
    createCGMDevice,
    getAllCGMDevices,
    getCGMDeviceById,
    updateCGMDevice,
    deleteCGMDevice,
    toggleCGMDeviceActive,
    importCGMDevicesCSV // 👈 Imported
} = require('../../../controllers/admin/CGM/CGMDeviceAdmin');

// Base URL: /admin/cgm/devices

// Tab ID: 36 (Manage Products)
router.post('/add', protect('admin'), checkRoleAccess(36), cgmDeviceUploads, createCGMDevice);
router.put('/update/:id', protect('admin'), checkRoleAccess(36), cgmDeviceUploads, updateCGMDevice);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteCGMDevice);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleCGMDeviceActive);

// 🚀 CSV / Excel Bulk Upload Route (Tab 36)
router.post('/bulk-import-csv', protect('admin'), checkRoleAccess(36), uploadExcel.single('file'), importCGMDevicesCSV);

// Public / User access for catalog browsing
router.get('/get', getAllCGMDevices);
router.get('/get/:id', getCGMDeviceById);

module.exports = router;