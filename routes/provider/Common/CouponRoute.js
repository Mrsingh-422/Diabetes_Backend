const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    createCoupon, 
    getMyCoupons, 
    createAdminCoupon, 
    toggleCoupon, 
    deleteCoupon,
    getCouponEnumTypes,
    getAdminCoupons,
    toggleAdminCoupon,
    deleteAdminCoupon,
    updateAdminCoupon,
    updateCoupon,
} = require('../../../controllers/provider/Common/Coupon');

// Base URL: /provider/coupons

// --- Vendor & Clinic Shared CRUD Routes ---
router.post('/add', protect(['provider', 'clinic']), createCoupon);
router.get('/list', protect(['provider', 'clinic']), getMyCoupons);
router.patch('/toggle/:id', protect(['provider', 'clinic']), toggleCoupon);
router.put('/update/:id', protect(['provider', 'clinic']), updateCoupon);
router.delete('/delete/:id', protect(['provider', 'clinic']), deleteCoupon);

// --- Public Route ---
router.get('/enum-types', getCouponEnumTypes);

// --- Admin Global Coupon Routes ---
router.post('/admin/add', protect('admin'), createAdminCoupon); 
router.get('/admin/list', protect('admin'), getAdminCoupons);
router.patch('/admin/toggle/:id', protect('admin'), toggleAdminCoupon);
router.put('/admin/update/:id', protect('admin'), updateAdminCoupon);
router.delete('/admin/delete/:id', protect('admin'), deleteAdminCoupon); 

module.exports = router;