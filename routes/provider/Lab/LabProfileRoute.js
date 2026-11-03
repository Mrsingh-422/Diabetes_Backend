const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
// ✅ MULTER IMPORT FIX: Ensure ye wahi naam hai jo middleware/upload.js mein export kiya hai
const { labDocUploads } = require('../../../middleware/multer'); 

const { getLabProfile, updateLabProfile, getMyAllServices,getLatestLabProfileRequest,getLabProfileHeader,
     changeLabPassword,getLabAccountType } = require('../../../controllers/provider/Lab/LabProfile');

// Base URL: /provider/labs/profile

router.get('/', protect('lab'), getLabProfile);

router.get('/header', protect('lab'), getLabProfileHeader);

// Add this route
router.get('/account-type', protect(['lab', 'clinic-lab']), getLabAccountType);

router.put('/update', protect('lab'), labDocUploads, updateLabProfile);

router.get('/services/all', protect('lab'), getMyAllServices);

router.get('/update-status', protect('lab'), getLatestLabProfileRequest);

router.patch('/change-password', protect('lab'), changeLabPassword);

module.exports = router;