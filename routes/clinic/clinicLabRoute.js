// routes/clinic/clinicLabRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { labDocUploads } = require('../../middleware/multer');

const {
    addClinicLab,
    getMyClinicLabs,
    getSingleClinicLab,
    updateClinicLab,
    toggleClinicLabStatus,
    deleteClinicLab,
    getClinicLabTimings,
    updateClinicLabTimings
} = require('../../controllers/clinic/clinicLabController');

// Base Route: /api/clinic/lab

// 1. Create New Clinic Lab
router.post('/add', protect('clinic'), labDocUploads, addClinicLab);

// 2. Get All Labs of Logged-In Clinic
router.get('/my-labs', protect('clinic'), getMyClinicLabs);

// 3. Get Single Lab Details
router.get('/details/:id', protect('clinic'), getSingleClinicLab);

// 4. Update Lab Details
router.put('/update/:id', protect('clinic'), labDocUploads, updateClinicLab);

// 5. Toggle Active/Inactive Status
router.patch('/toggle-status/:id', protect('clinic'), toggleClinicLabStatus);

// 6. Delete Lab
router.delete('/delete/:id', protect('clinic'), deleteClinicLab);

router.get('/timings', protect('clinic'), getClinicLabTimings);
router.put('/timings/update', protect('clinic'), updateClinicLabTimings);

module.exports = router;