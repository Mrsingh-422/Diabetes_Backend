// routes/clinic/clinicPharmacyRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { pharmacyDocUploads } = require('../../middleware/multer'); // 👈 Same pharmacy multer used

const {
    addClinicPharmacy,
    getMyClinicPharmacies,
    getSingleClinicPharmacy,
    updateClinicPharmacy,
    toggleClinicPharmacyStatus,
    deleteClinicPharmacy,
    getClinicPharmacyTimings,
    updateClinicPharmacyTimings
} = require('../../controllers/clinic/clinicPharmacyController');

// Base Route: /api/clinic/pharmacy

// 1. Create New Clinic Pharmacy (Protected with protect('clinic') & pharmacyDocUploads)
router.post('/add', protect('clinic'), pharmacyDocUploads, addClinicPharmacy);

// 2. Get All Pharmacies of Logged-In Clinic
router.get('/my-pharmacies', protect('clinic'), getMyClinicPharmacies);

// 3. Get Single Pharmacy Details
router.get('/details/:id', protect('clinic'), getSingleClinicPharmacy);

// 4. Update Pharmacy (Submits approval request to Admin if approved)
router.put('/update/:id', protect('clinic'), pharmacyDocUploads, updateClinicPharmacy);

// 5. Toggle Active/Inactive Status
router.patch('/toggle-status/:id', protect('clinic'), toggleClinicPharmacyStatus);

// 6. Delete Pharmacy
router.delete('/delete/:id', protect('clinic'), deleteClinicPharmacy);

router.get('/timings', protect('clinic'), getClinicPharmacyTimings);
router.put('/timings/update', protect('clinic'), updateClinicPharmacyTimings);

module.exports = router;