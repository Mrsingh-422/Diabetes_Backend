// routes/user/clinicManageRoute.js
const express = require('express');
const router = express.Router();
const {
    getNearestClinics,
    getClinicDetailsForUser,
    getClinicDoctorsAndBeds,
    getClinicCouponsForUser,
    getClinicAmbulancesForUser,
    getClinicSearchSuggestions,
    

} = require('../../../controllers/user/Clinic/clinicManageController');

// Base Route: /api/user/clinics

// 1. Location-based Nearest Clinics (POST API with lat, lng, search & pagination)
router.post('/nearest', getNearestClinics);

// 2. 🔍 Live Search Suggestions (2-Letter Auto-Suggest)
router.post('/search-suggestions', getClinicSearchSuggestions);

router.get('/:clinicId/doctors-and-beds', getClinicDoctorsAndBeds);

// 2. Full Clinic Details & Doctors List on Card Click

router.get('/:id', getClinicDetailsForUser);
router.get('/coupons/:clinicId', getClinicCouponsForUser);
router.get('/ambulances/:clinicId', getClinicAmbulancesForUser);





module.exports = router;