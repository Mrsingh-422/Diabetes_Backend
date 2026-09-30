// routes/admin/others/ambulanceFacilityRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    createAmbulanceFacility,
    getAllAmbulanceFacilities,
    getSingleAmbulanceFacility,
    updateAmbulanceFacility,
    toggleAmbulanceFacilityStatus,
    deleteAmbulanceFacility
} = require('../../../controllers/admin/others/ambulanceFacilityController');

// Base Route: /admin/ambulance-facilities

router.post('/create', protect('admin'), createAmbulanceFacility);
router.get('/list', getAllAmbulanceFacilities); // Public / Dropdown for Partners & Admin
router.get('/details/:id', protect('admin'), getSingleAmbulanceFacility);
router.put('/update/:id', protect('admin'), updateAmbulanceFacility);
router.patch('/toggle-status/:id', protect('admin'), toggleAmbulanceFacilityStatus);
router.delete('/delete/:id', protect('admin'), deleteAmbulanceFacility);

module.exports = router;