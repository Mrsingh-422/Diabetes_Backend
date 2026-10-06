// routes/user/CGMDevices/UserCGMDeviceRoute.js

const express = require('express');
const router = express.Router();

const {
    getUserCGMDevices,
    getUserCGMDeviceById,
    getUserActiveCategories
} = require('../../../controllers/user/CGMDevices/UserCGMDeviceController');

// Base URL: /user/cgm/devices

// 1. Get Top Categories (For Tabs: Glucometers | CGM | Supplements)
router.get('/categories', getUserActiveCategories);

// 2. Get All Products (Storefront Lightweight Catalog with Filters & Search)
router.get('/get', getUserCGMDevices);

// 3. Get Single Product by ID (Full Detailed View)
router.get('/get/:id', getUserCGMDeviceById);

module.exports = router;