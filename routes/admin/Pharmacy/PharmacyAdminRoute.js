const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetApprovedPharmacies,
    adminGetPharmacyVendorsForOrders,
    adminGetOrdersByPharmacyId,
    adminGetPharmacyBookingDetails,
    adminGetCancelledPharmacyOrders,
    adminGetPharmacyBookings,
    toggleActiveInactivePharmacy
} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy
router.use(protect('admin'));
router.use(checkRoleAccess(5)); // Manage Orders Permission

// 1. Vendors list showing stores with order statistics (Step 1)
router.get('/vendors-list', adminGetPharmacyVendorsForOrders);

// 2. Specific Pharmacy Vendor's Orders on Click (Step 2)
router.get('/vendors/:pharmacyId/orders', adminGetOrdersByPharmacyId);

// 3. Complete Single Order Details (Step 3)
router.get('/bookings/details/:orderId', adminGetPharmacyBookingDetails);

// 4. Dedicated Cancelled Orders API (Step 4)
router.get('/cancelled-orders', adminGetCancelledPharmacyOrders);

// 5. Global All Bookings
router.get('/bookings', adminGetPharmacyBookings);

// 6. Approved Pharmacies List
router.get('/approved-list', adminGetApprovedPharmacies);

// 7. Pharmacy Store Active/Inactive Toggle
router.patch('/status/active-inactive/:pharmacyId', toggleActiveInactivePharmacy);

module.exports = router;