const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../middleware/authMiddleware');

const {
    // getDoctorsList,
     approveDoctor, rejectDoctor,
    
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,

} = require('../../controllers/admin/approvalController');

// Base Path: /api/admin/approval

// --- DOCTOR (ID: 31) ---
// router.get('/doctors', protect('admin'), checkRoleAccess(31), getDoctorsList);
router.patch('/doctors/approve/:id', protect('admin'), checkRoleAccess(31), approveDoctor);
router.patch('/doctors/reject/:id', protect('admin'), checkRoleAccess(31), rejectDoctor);


// --- PHARMACY (ID: 28) ---
router.get('/pharmacy', protect('admin'), checkRoleAccess(28), getPharmaciesList);
router.patch('/pharmacy/approve/:id', protect('admin'), checkRoleAccess(28), approvePharmacy);
router.patch('/pharmacy/reject/:id', protect('admin'), checkRoleAccess(28), rejectPharmacy);

// --- LAB (ID: 29) ---
router.get('/lab', protect('admin'), checkRoleAccess(29), getLabsList);
router.patch('/lab/approve/:id', protect('admin'), checkRoleAccess(29), approveLab);
router.patch('/lab/reject/:id', protect('admin'), checkRoleAccess(29), rejectLab);




module.exports = router;