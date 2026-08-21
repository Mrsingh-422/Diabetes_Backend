const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { saveDeliveryCharges, getMyDeliveryCharges } = require('../../../controllers/provider/Common/Delivery');
const Admin = require('../../../models/Admin');

// Base URL: /provider/delivery-charges

router.post('/save', protect('provider'), saveDeliveryCharges);
router.get('/my-charges', protect('provider'), getMyDeliveryCharges);

// =========== manage by Admin ================
router.post('/admin/save', protect('admin'), saveDeliveryCharges);
router.get('/admin/my-charges', protect('admin'), getMyDeliveryCharges);

module.exports = router;