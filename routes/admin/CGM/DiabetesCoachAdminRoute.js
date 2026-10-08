// routes/admin/CGM/DiabetesCoachAdminRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { diabetesCoachUpload } = require('../../../middleware/multer');

const {
    createCoach,
    getAllCoaches,
    getCoachById,
    updateCoach,
    deleteCoach,
    toggleCoachStatus,

} = require('../../../controllers/admin/CGM/DiabetesCoachAdmin');

// Base URL: /admin/cgm/coaches

// Tab ID: 36
router.post('/add', protect('admin'), checkRoleAccess(36), diabetesCoachUpload, createCoach);
router.put('/update/:id', protect('admin'), checkRoleAccess(36), diabetesCoachUpload, updateCoach);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteCoach);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleCoachStatus);

// Listing & Details
router.get('/all', protect('admin'), checkRoleAccess(36), getAllCoaches);
router.get('/detail/:id', protect('admin'), checkRoleAccess(36), getCoachById);


module.exports = router;