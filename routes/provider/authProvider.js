const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { labDocUploads, pharmacyDocUploads,   } = require('../../middleware/multer'); // Multer import

const { 
    registerProvider, 
    loginProvider, 
    toggleProviderOnlineStatus,
    uploadLabDocs, 
    uploadPharmacyDocs, 
    uploadFoodDocs, // <-- Now cleanly imported!
    forgotPasswordProvider, 
    resetPasswordProvider, 
    getProviderProfile 
} = require('../../controllers/provider/authProvider.js'); // Fixed Broken Destructuring

// Base route: /api/auth/provider

// 1. Step 1: Register (Basic Info)
router.post('/register', registerProvider);

// 2. Step 2: Login (Get Token & check profileStatus)
router.post('/login', loginProvider);
router.patch('/status/toggle', protect('provider'), toggleProviderOnlineStatus);

router.post('/forgot-password', forgotPasswordProvider);
router.post('/reset-password', resetPasswordProvider);

// 3. Step 3: Complete Profile (Upload Documents)
// Lab
router.put('/upload-docs/lab', protect('lab'), labDocUploads, uploadLabDocs);

// Pharmacy
router.put('/upload-docs/pharmacy', protect('pharmacy'), pharmacyDocUploads, uploadPharmacyDocs);

// Food (Added as per request)
// router.put('/upload-docs/food', protect('food'), foodDocUploads, uploadFoodDocs);

// 4. Get Profile (For Dashboard)
router.get('/profile', protect('provider'), getProviderProfile);

module.exports = router;