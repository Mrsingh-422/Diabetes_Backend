// routes/clinic/clinicDoctorPannel/clinicDocAppointmentRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { docPrescriptionUpload } = require('../../../middleware/multer');

const {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById,
    respondToAssignedAppointment,
    startClinicConsultation,
    recordClinicAppointmentVitals,
    getClinicDoctorMedicines,
    getClinicDoctorLabTests,
    prescribeClinicAppointment,
    sendAppointmentToClinicPharmacy,
    sendAppointmentToClinicLab,
    getClinicDoctorAvailableBeds,
    referAppointmentToAdmission,
    getAvailableSecondaryClinicDoctors,
    addSecondaryDoctorOrOpinion,
    respondToSecondaryDoctorRequest,
    submitSecondaryDoctorOpinion,
    completeClinicConsultation,
    referToAnotherDoctor
} = require('../../../controllers/clinic/clinicDoctorPannel/clinicDocAppointment');

// Base Route: /api/clinic/doctor-panel

// --- LOOKUP / CATALOG ROUTES (Must stay before /appointments/:id) ---
router.get('/appointments/medicines', protect('clinic-doctor'), getClinicDoctorMedicines);
router.get('/appointments/lab-tests', protect('clinic-doctor'), getClinicDoctorLabTests);
router.get('/appointments/available-beds', protect('clinic-doctor'), getClinicDoctorAvailableBeds);
router.get('/appointments/available-doctors', protect('clinic-doctor'), getAvailableSecondaryClinicDoctors);

// --- LIST & RESPOND ---
router.get('/appointments', protect('clinic-doctor'), getClinicDoctorAppointments);
router.patch('/appointments/respond', protect('clinic-doctor'), respondToAssignedAppointment);

// --- SINGLE APPOINTMENT DETAILS ---
router.get('/appointments/:id', protect('clinic-doctor'), getClinicDoctorAppointmentById);
router.patch('/appointments/:id/respond', protect('clinic-doctor'), respondToAssignedAppointment);

// --- OPD EXAMINATION, VITALS & PRESCRIPTION ---
router.patch('/appointments/:id/start-consultation', protect('clinic-doctor'), startClinicConsultation);
router.patch('/appointments/:id/vitals', protect('clinic-doctor'), recordClinicAppointmentVitals);
router.post('/appointments/:id/prescribe', protect('clinic-doctor'), docPrescriptionUpload, prescribeClinicAppointment);
router.patch('/appointments/:id/complete-consultation', protect('clinic-doctor'), completeClinicConsultation);

// --- REFERRALS: CLINIC PHARMACY, CLINIC LAB & ADMISSION ---
router.post('/appointments/:id/send-to-pharmacy', protect('clinic-doctor'), sendAppointmentToClinicPharmacy);
router.post('/appointments/:id/send-to-lab', protect('clinic-doctor'), sendAppointmentToClinicLab);
router.post('/appointments/:id/refer-admission', protect('clinic-doctor'), referAppointmentToAdmission);

// --- SECONDARY DOCTOR & SECOND OPINION WORKFLOW ---
router.post('/appointments/:id/add-secondary-doctor', protect('clinic-doctor'), addSecondaryDoctorOrOpinion);
router.patch('/appointments/:id/secondary-doctor/respond', protect('clinic-doctor'), respondToSecondaryDoctorRequest);
router.post('/appointments/:id/secondary-doctor/opinion', protect('clinic-doctor'), submitSecondaryDoctorOpinion);

router.post('/appointments/:id/refer-to-doctor', protect('clinic-doctor'), referToAnotherDoctor);

module.exports = router;