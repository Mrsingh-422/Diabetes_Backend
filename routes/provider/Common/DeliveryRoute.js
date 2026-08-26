const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { saveDeliveryCharges, getMyDeliveryCharges,updateDeliveryCharges } = require('../../../controllers/provider/Common/Delivery');
const Admin = require('../../../models/Admin');

// Base URL: /provider/delivery-charges

// --- Vendor Routes ---
router.post('/save', protect('provider'), saveDeliveryCharges);
router.put('/update', protect('provider'), updateDeliveryCharges);
router.get('/my-charges', protect('provider'), getMyDeliveryCharges);

// --- Admin Routes ---
router.post('/admin/save', protect('admin'), saveDeliveryCharges);
router.put('/admin/update', protect('admin'), updateDeliveryCharges);          // 👈 Global Admin Update (No ID needed)
router.put('/admin/update/:id', protect('admin'), updateDeliveryCharges);      // 👈 Update by Document ID
router.get('/admin/my-charges', protect('admin'), getMyDeliveryCharges);
module.exports = router;