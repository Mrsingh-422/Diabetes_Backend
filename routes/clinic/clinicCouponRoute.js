// routes/clinic/clinicCouponRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {
    createAmbulanceCoupon,
    getMyCoupons,
    updateAmbulanceCoupon,
    toggleAmbulanceCouponStatus,
    deleteAmbulanceCoupon
} = require('../../controllers/clinic/clinicCouponController');

// Roles allowed to manage coupons:
const allowedRoles = ['admin', 'clinic', 'ambulance'];

router.post('/create', protect(allowedRoles), createAmbulanceCoupon);
router.get('/my-coupons', protect(allowedRoles), getMyCoupons);
router.put('/update/:id', protect(allowedRoles), updateAmbulanceCoupon);
router.patch('/toggle-status/:id', protect(allowedRoles), toggleAmbulanceCouponStatus);
router.delete('/delete/:id', protect(allowedRoles), deleteAmbulanceCoupon);

module.exports = router;