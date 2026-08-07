const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');
const { registerDriver } = require('../../../controllers/provider/Lab/LabDriver');

// Base URL: /provider/lab/driver

router.post('/add', protect('lab'), driverDocUploads, registerDriver); 
// Note: Agal alag routes ke liye protect mein 'pharmacy' ya 'Food' pass karein



module.exports = router;