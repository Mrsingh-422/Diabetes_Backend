// routes/coach/authCoachRoute.js

const express = require('express');
const router = express.Router();
const { diabetesCoachUpload } = require('../../middleware/multer');

const {
    registerCoach,
    loginCoach
} = require('../../controllers/coach/authCoachController');

// Base URL: /api/auth/coach

// 1. Direct Self-Registration (With profile photo upload)
router.post('/register', diabetesCoachUpload, registerCoach);

// 2. Direct Login
router.post('/login', loginCoach);

module.exports = router;