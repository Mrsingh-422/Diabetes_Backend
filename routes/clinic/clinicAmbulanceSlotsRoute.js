// routes/clinic/clinicAmbulanceSlotsRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {
    getClinicAmbulanceSlots,
    updateClinicAmbulanceSlots,
    blockClinicAmbulanceSlot,
    unblockClinicAmbulanceSlot
} = require('../../controllers/clinic/clinicAmbulanceSlots');

// Base Route: /api/clinic/ambulance-slots

// 1. Get Clinic Ambulance Slots & Schedule
router.get('/', protect('clinic'), getClinicAmbulanceSlots);

// 2. Set / Update Clinic Ambulance Schedule & Buffer
router.put('/update', protect('clinic'), updateClinicAmbulanceSlots);

// 3. Block Slot
router.post('/block-slot', protect('clinic'), blockClinicAmbulanceSlot);

// 4. Unblock Slot
router.post('/unblock-slot', protect('clinic'), unblockClinicAmbulanceSlot);

module.exports = router;