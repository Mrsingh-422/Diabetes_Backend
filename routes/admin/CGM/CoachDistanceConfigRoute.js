// routes/admin/CGM/CoachDistanceConfigRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getDistanceConfig,
    setDistanceConfig
} = require('../../../controllers/admin/CGM/CoachDistanceConfig');

// Base URL: /admin/cgm/coach-distance-config

router.get('/', protect('admin'), checkRoleAccess(36), getDistanceConfig);
router.put('/', protect('admin'), checkRoleAccess(36), setDistanceConfig);

module.exports = router;