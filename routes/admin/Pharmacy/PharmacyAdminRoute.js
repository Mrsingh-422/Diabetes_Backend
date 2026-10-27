const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetPharmacyBookings,
    adminGetPharmacyBookingDetails, 
    adminGetApprovedPharmacies,
    toggleActiveInactivePharmacy
} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy
router.use(protect('admin'));
router.use(checkRoleAccess(5)); // Manage Orders Permission

// 1. Approved Pharmacies List
router.get('/approved-list', adminGetApprovedPharmacies);

// 2. Orders Table (Lightweight Summary)
router.get('/bookings', adminGetPharmacyBookings);

// 🌟 3. NEW: Complete Order Details (Medicine, Vendor, User & Bill Summary)
router.get('/bookings/details/:orderId', adminGetPharmacyBookingDetails);

// 4. Pharmacy Store Active/Inactive Toggle
router.patch('/status/active-inactive/:pharmacyId', toggleActiveInactivePharmacy);

module.exports = router;