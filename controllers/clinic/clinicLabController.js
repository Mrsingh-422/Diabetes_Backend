// controllers/clinic/clinicLabController.js
const Lab = require('../../models/Lab');
const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const Appointment = require('../../models/Appointment');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { deleteFile } = require('../../utils/fileHandler');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// ==========================================
// 1. ADD CLINIC LAB (With Strict 1-Lab Check & Timings)
// Endpoint: POST /api/clinic/lab/add
// ==========================================
const addClinicLab = async (req, res) => {
    try {
        const clinicId = req.user.id; // From protect('clinic')
        const files = req.files || {};

        // 🛡️ 1. STRICT CHECK: Ek clinic sirf 1 hi lab bana sakti hai (jab tak delete na ho jaye)
        const existingClinicLab = await Lab.findOne({ clinicId, isClinic: true });
        if (existingClinicLab) {
            // Disk Cleanup for uploaded files
            if (files.profileImage) deleteFile(`/uploads/labs/${files.profileImage[0].filename}`);
            if (files.signatureImage) deleteFile(`/uploads/labs/${files.signatureImage[0].filename}`);
            ['labImages', 'labCertificates', 'labLicenses', 'gstCertificates', 'drugLicenses', 'otherCertificates'].forEach(key => {
                if (files[key]) files[key].forEach(f => deleteFile(`/uploads/labs/${f.filename}`));
            });

            return res.status(400).json({
                success: false,
                message: "A Diagnostic Lab is already registered for this clinic facility. You cannot create another lab unless the existing one is deleted."
            });
        }
        
        const {
            name,
            email,
            phone,
            alternatePhone,
            password,
            address,
            city,
            state,
            country = 'India',
            latitude = 0,
            longitude = 0,
            about = "",
            isHomeCollectionAvailable = false,
            isRapidServiceAvailable = false,
            isInsuranceAccepted = false,
            acceptedInsurances,
            is24x7 = false,

            // ⏰ Timings & Holiday
            openingTime = "08:00 AM",
            closeTime = "08:00 PM",
            holiday = "Sunday",

            // Documents & Accreditation Fields
            documentState = "",
            issuingAuthority = "",
            gstNumber = "",
            experience = "",
            nablNumber = "",
            drugLicenseType = "None",

            bankDetails
        } = req.body;

        // 2. Validations
        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: "Lab Name and Phone Number are required."
            });
        }

        if (!password) {
            return res.status(400).json({
                success: false,
                message: "Password is required."
            });
        }

        // 3. Global Duplicate Check
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });

        const existing = await Lab.findOne({ $or: query });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "A lab with this Email or Phone number already exists."
            });
        }

        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        // 4. Process Uploaded Files using labDocUploads
        const profileImagePath = files.profileImage?.[0] 
            ? `/uploads/labs/${files.profileImage[0].filename}` 
            : null;

        const signatureImagePath = files.signatureImage?.[0] 
            ? `/uploads/labs/${files.signatureImage[0].filename}` 
            : null;

        const documentsObj = {
            documentState: documentState || state || "",
            issuingAuthority,
            gstNumber,
            experience,
            nablNumber,
            drugLicenseType,
            labImages: files.labImages ? files.labImages.map(f => `/uploads/labs/${f.filename}`) : [],
            labCertificates: files.labCertificates ? files.labCertificates.map(f => `/uploads/labs/${f.filename}`) : [],
            labLicenses: files.labLicenses ? files.labLicenses.map(f => `/uploads/labs/${f.filename}`) : [],
            gstCertificates: files.gstCertificates ? files.gstCertificates.map(f => `/uploads/labs/${f.filename}`) : [],
            drugLicenses: files.drugLicenses ? files.drugLicenses.map(f => `/uploads/labs/${f.filename}`) : [],
            otherCertificates: files.otherCertificates ? files.otherCertificates.map(f => `/uploads/labs/${f.filename}`) : []
        };

        // 5. Hash Password & Parse JSONs
        const hashedPassword = await bcrypt.hash(String(password), 10);

        let parsedBankDetails = {};
        if (bankDetails) {
            try {
                parsedBankDetails = typeof bankDetails === 'string' ? JSON.parse(bankDetails) : bankDetails;
            } catch (e) {
                parsedBankDetails = {};
            }
        }

        let parsedInsurances = [];
        if (acceptedInsurances) {
            try {
                parsedInsurances = typeof acceptedInsurances === 'string' ? JSON.parse(acceptedInsurances) : acceptedInsurances;
            } catch (e) {
                parsedInsurances = [];
            }
        }

        const is24x7Bool = is24x7 === 'true' || is24x7 === true;

        // 6. Create Lab Record
        const newLab = await Lab.create({
            clinicId,
            isClinic: true,
            role: 'clinic-lab',
            name,
            email: email ? email.toLowerCase() : undefined,
            phone,
            alternatePhone: alternatePhone || null,
            password: hashedPassword,

            country,
            state,
            city,
            address,
            location: {
                lat: Number(latitude),
                lng: Number(longitude)
            },

            about,
            isHomeCollectionAvailable: isHomeCollectionAvailable === 'true' || isHomeCollectionAvailable === true,
            isRapidServiceAvailable: isRapidServiceAvailable === 'true' || isRapidServiceAvailable === true,
            isInsuranceAccepted: isInsuranceAccepted === 'true' || isInsuranceAccepted === true,
            acceptedInsurances: parsedInsurances,
            is24x7: is24x7Bool,
            openingTime: is24x7Bool ? "12:00 AM" : openingTime,
            closeTime: is24x7Bool ? "11:59 PM" : closeTime,
            holiday: is24x7Bool ? "None" : holiday,

            profileImage: profileImagePath,
            signatureImage: signatureImagePath,
            documents: documentsObj,
            bankDetails: parsedBankDetails,

            profileStatus: 'Pending',
            isActive: true,
            isOnline: false
        });

        const clinicName = clinic.clinicName || clinic.name || "Clinic";

        // 7. Create Admin Approval Request
        await ProfileUpdateRequest.create({
            vendorId: newLab._id,
            vendorModel: 'Lab',
            updatedFields: {
                name: newLab.name,
                email: newLab.email,
                phone: newLab.phone,
                clinicId: clinicId,
                clinicName: clinicName,
                address: newLab.address,
                city: newLab.city,
                state: newLab.state,
                openingTime: newLab.openingTime,
                closeTime: newLab.closeTime,
                holiday: newLab.holiday,
                is24x7: newLab.is24x7,
                documents: documentsObj,
                profileImage: profileImagePath,
                signatureImage: signatureImagePath
            },
            status: 'Pending'
        });

        // 8. Notify Admins
        try {
            await notifyAdminsAndVendor(
                newLab._id,
                'lab',
                "New Clinic Lab Approval Request",
                `${clinicName} has registered a Clinic Lab (${newLab.name}). Please review documents for approval.`
            );
        } catch (notifErr) {
            console.error("Admin Notification error on lab registration:", notifErr.message);
        }

        const responseData = newLab.toObject();
        delete responseData.password;

        res.status(201).json({
            success: true,
            message: `Clinic Lab '${newLab.name}' registered successfully and submitted to Admin for approval.`,
            profileStatus: 'Pending',
            data: responseData
        });

    } catch (error) {
        console.error("Add Clinic Lab Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET ALL LABS OF LOGGED-IN CLINIC
// Endpoint: GET /api/clinic/lab/my-labs
// ==========================================
const getMyClinicLabs = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const labs = await Lab.find({ clinicId, isClinic: true })
            .select('-password -token -fcmToken')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: labs.length,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET SINGLE CLINIC LAB DETAILS
// Endpoint: GET /api/clinic/lab/details/:id
// ==========================================
const getSingleClinicLab = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const lab = await Lab.findOne({ _id: id, clinicId, isClinic: true })
            .select('-password -token -fcmToken');

        if (!lab) {
            return res.status(404).json({ success: false, message: "Clinic lab not found." });
        }

        res.json({
            success: true,
            data: lab
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UPDATE CLINIC LAB (Submits to Admin Approval Queue if already Approved)
// Endpoint: PUT /api/clinic/lab/update/:id
// ==========================================
const updateClinicLab = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = { ...req.body };

        const lab = await Lab.findOne({ _id: id, clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found or unauthorized." });
        }

        // Security parameters exclusion
        delete updates.password;
        delete updates.role;
        delete updates.isClinic;
        delete updates.clinicId;
        delete updates.token;
        delete updates.fcmToken;
        delete updates.rejectionReason;

        // Check Unique Email / Phone
        if (updates.email && updates.email.toLowerCase() !== lab.email) {
            const emailExists = await Lab.findOne({ _id: { $ne: id }, email: updates.email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "Email is already registered with another lab." });
            }
            updates.email = updates.email.toLowerCase();
        }

        if (updates.phone && updates.phone !== lab.phone) {
            const phoneExists = await Lab.findOne({ _id: { $ne: id }, phone: updates.phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: "Phone number is already in use." });
            }
        }

        // Documents handling
        const currentDocs = lab.documents || {};
        const updatedDocs = {
            documentState: updates.documentState !== undefined ? updates.documentState : currentDocs.documentState,
            issuingAuthority: updates.issuingAuthority !== undefined ? updates.issuingAuthority : currentDocs.issuingAuthority,
            gstNumber: updates.gstNumber !== undefined ? updates.gstNumber : currentDocs.gstNumber,
            experience: updates.experience !== undefined ? updates.experience : currentDocs.experience,
            nablNumber: updates.nablNumber !== undefined ? updates.nablNumber : currentDocs.nablNumber,
            drugLicenseType: updates.drugLicenseType !== undefined ? updates.drugLicenseType : currentDocs.drugLicenseType,

            labImages: files.labImages
                ? files.labImages.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.labImages,

            labCertificates: files.labCertificates
                ? files.labCertificates.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.labCertificates,

            labLicenses: files.labLicenses
                ? files.labLicenses.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.labLicenses,

            gstCertificates: files.gstCertificates
                ? files.gstCertificates.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.gstCertificates,

            drugLicenses: files.drugLicenses
                ? files.drugLicenses.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.drugLicenses,

            otherCertificates: files.otherCertificates
                ? files.otherCertificates.map(f => `/uploads/labs/${f.filename}`)
                : currentDocs.otherCertificates
        };

        if (files.profileImage?.[0]) {
            updates.profileImage = `/uploads/labs/${files.profileImage[0].filename}`;
        }
        if (files.signatureImage?.[0]) {
            updates.signatureImage = `/uploads/labs/${files.signatureImage[0].filename}`;
        }

        updates.documents = updatedDocs;

        if (updates.latitude !== undefined || updates.longitude !== undefined) {
            updates.location = {
                lat: updates.latitude ? Number(updates.latitude) : lab.location?.lat || 0,
                lng: updates.longitude ? Number(updates.longitude) : lab.location?.lng || 0
            };
        }

        if (typeof updates.bankDetails === 'string') {
            try { updates.bankDetails = JSON.parse(updates.bankDetails); } catch (e) {}
        }
        if (typeof updates.acceptedInsurances === 'string') {
            try { updates.acceptedInsurances = JSON.parse(updates.acceptedInsurances); } catch (e) {}
        }

        const clinic = await Clinic.findById(clinicId).select('name clinicName');
        const isApproved = lab.profileStatus === 'Approved';

        // 🚨 CASE 1: ALREADY APPROVED -> Send Request to Admin for Approval
        if (isApproved) {
            const existingPending = await ProfileUpdateRequest.findOne({
                vendorId: lab._id,
                vendorModel: 'Lab',
                status: 'Pending'
            });

            if (existingPending) {
                if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                    deleteFile(existingPending.updatedFields.profileImage);
                }
                if (updates.signatureImage && existingPending.updatedFields?.signatureImage) {
                    deleteFile(existingPending.updatedFields.signatureImage);
                }
                await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
            }

            const request = await ProfileUpdateRequest.create({
                vendorId: lab._id,
                vendorModel: 'Lab',
                updatedFields: {
                    ...updates,
                    labId: lab._id,
                    labName: lab.name,
                    clinicId,
                    clinicName: clinic ? (clinic.clinicName || clinic.name) : "Clinic"
                },
                status: 'Pending'
            });

            // Notify Admin
            try {
                await notifyAdminsAndVendor(
                    lab._id,
                    'lab',
                    "Clinic Lab Update Approval Request",
                    `${clinic ? (clinic.clinicName || clinic.name) : 'Clinic'} has submitted updated details for lab '${lab.name}'. Please review and approve.`
                );
            } catch (notifErr) {
                console.error("Admin notification error:", notifErr.message);
            }

            return res.json({
                success: true,
                message: `Profile update request for '${lab.name}' submitted to Admin for approval.`,
                status: 'Pending',
                requestId: request._id,
                data: request
            });
        }

        // 🚨 CASE 2: INCOMPLETE / REJECTED / PENDING STATE -> Direct Update
        const updatedLab = await Lab.findByIdAndUpdate(
            id,
            { 
                $set: {
                    ...updates,
                    profileStatus: 'Pending',
                    rejectionReason: null
                }
            },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: "Clinic Lab details updated and submitted for verification.",
            data: updatedLab
        });

    } catch (error) {
        console.error("Update Clinic Lab Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. TOGGLE LAB ACTIVE/INACTIVE STATUS
// Endpoint: PATCH /api/clinic/lab/toggle-status/:id
// ==========================================
const toggleClinicLabStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const lab = await Lab.findOne({ _id: id, clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "Clinic Lab not found." });
        }

        lab.isActive = !lab.isActive;
        await lab.save();

        res.json({
            success: true,
            message: `Lab '${lab.name}' is now ${lab.isActive ? 'Active' : 'Inactive'}.`,
            isActive: lab.isActive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. DELETE CLINIC LAB
// Endpoint: DELETE /api/clinic/lab/delete/:id
// ==========================================
const deleteClinicLab = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const lab = await Lab.findOne({ _id: id, clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "Clinic Lab not found or unauthorized." });
        }

        // Disk Cleanup
        if (lab.profileImage) deleteFile(lab.profileImage);
        if (lab.signatureImage) deleteFile(lab.signatureImage);
        if (lab.documents) {
            const docFields = ['labImages', 'labCertificates', 'labLicenses', 'gstCertificates', 'drugLicenses', 'otherCertificates'];
            docFields.forEach(field => {
                if (Array.isArray(lab.documents[field])) {
                    lab.documents[field].forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }

        await Lab.findByIdAndDelete(id);

        res.json({
            success: true,
            message: `Clinic Lab '${lab.name}' and all associated documents removed successfully.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// GET CLINIC LAB TIMINGS
// Endpoint: GET /api/clinic/lab/timings
// ==========================================
const getClinicLabTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const lab = await Lab.findOne({ clinicId, isClinic: true })
            .select('name is24x7 openingTime closeTime holiday');

        if (!lab) {
            return res.status(404).json({ success: false, message: "Clinic Lab not found." });
        }

        res.json({
            success: true,
            data: {
                is24x7: lab.is24x7,
                openingTime: lab.openingTime || "08:00 AM",
                closeTime: lab.closeTime || "08:00 PM",
                holiday: lab.holiday || "Sunday",
                displayTiming: lab.is24x7 ? "Open 24x7" : `${lab.openingTime} - ${lab.closeTime}`
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// SET / UPDATE CLINIC LAB TIMINGS
// Endpoint: PUT /api/clinic/lab/timings
// ==========================================
const updateClinicLabTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { is24x7, openingTime, closeTime, holiday } = req.body;

        const lab = await Lab.findOne({ clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "Clinic Lab not found." });
        }

        const is24x7Bool = is24x7 === true || is24x7 === 'true';

        lab.is24x7 = is24x7Bool;
        lab.openingTime = is24x7Bool ? "12:00 AM" : (openingTime || lab.openingTime || "08:00 AM");
        lab.closeTime = is24x7Bool ? "11:59 PM" : (closeTime || lab.closeTime || "08:00 PM");
        lab.holiday = is24x7Bool ? "None" : (holiday || lab.holiday || "Sunday");

        await lab.save();

        res.json({
            success: true,
            message: "Clinic Lab timings updated successfully.",
            data: {
                is24x7: lab.is24x7,
                openingTime: lab.openingTime,
                closeTime: lab.closeTime,
                holiday: lab.holiday
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 9. GET ALL DOCTOR-REFERRED LAB TEST REQUESTS (Read-Only for Clinic Lab)
// @route   GET /api/clinic/lab/doctor-referrals?priority=Urgent&search=...
// @access  Private (Clinic or Clinic Lab)
// ==========================================
const getClinicLabDoctorReferrals = async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        const { priority, status, search, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (pageNum - 1) * limitNum;

        let clinicId = null;
        let labId = null;

        if (userRole === 'clinic') {
            clinicId = req.user.id;
            const clinicLab = await Lab.findOne({ clinicId, isClinic: true }).select('_id').lean();
            labId = clinicLab?._id || null;
        } else {
            labId = req.user.id;
            clinicId = req.user.clinicId || null;
        }

        const andConditions = [
            { 'clinicLabReferral.status': { $in: ['Sent', 'Sample-Collected', 'Report-Ready'] } }
        ];

        if (clinicId) {
            andConditions.push({ clinicId });
        }
        if (labId) {
            andConditions.push({
                $or: [
                    { 'clinicLabReferral.labId': labId },
                    { 'clinicLabReferral.labId': null }
                ]
            });
        }

        if (priority && String(priority).trim() !== '') {
            andConditions.push({ 'clinicLabReferral.priority': String(priority).trim() });
        }
        if (status && String(status).trim() !== '') {
            andConditions.push({ 'clinicLabReferral.status': String(status).trim() });
        }
        if (search && String(search).trim() !== '') {
            const regex = new RegExp(String(search).trim(), 'i');
            andConditions.push({
                $or: [
                    { bookingId: regex },
                    { formattedToken: regex },
                    { 'patients.patientName': regex },
                    { 'clinicLabReferral.tests.name': regex }
                ]
            });
        }

        const query = { $and: andConditions };

        const [totalDocs, appointments] = await Promise.all([
            Appointment.countDocuments(query),
            Appointment.find(query)
                .select('_id bookingId bookingType tokenNumber formattedToken appointmentDate appointmentTime patients userId doctorId clinicLabReferral')
                .populate('userId', 'name phone email gender age')
                .populate('doctorId', 'name speciality cabinNumber profileImage')
                .populate('clinicLabReferral.sentBy', 'name speciality cabinNumber')
                .sort({ 'clinicLabReferral.sentAt': -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const data = appointments.map((appt) => {
            const primaryPatient = appt.patients?.[0] || {};
            const isSelf = Boolean(primaryPatient.isMainUser) || (primaryPatient.relation || '').toLowerCase() === 'self' || (primaryPatient.patientName || '').toLowerCase().includes('myself');

            return {
                appointmentId: appt._id,
                bookingId: appt.bookingId,
                bookingType: appt.bookingType,
                formattedToken: appt.formattedToken || "",
                patient: {
                    name: isSelf ? (appt.userId?.name || primaryPatient.patientName) : primaryPatient.patientName,
                    age: primaryPatient.patientAge || appt.userId?.age || null,
                    gender: primaryPatient.gender || appt.userId?.gender || null,
                    phone: appt.userId?.phone || ""
                },
                referredByDoctor: appt.clinicLabReferral?.sentBy || appt.doctorId || null,
                priority: appt.clinicLabReferral?.priority || 'Routine',
                status: appt.clinicLabReferral?.status || 'Sent',
                notes: appt.clinicLabReferral?.notes || "",
                tests: appt.clinicLabReferral?.tests || [],
                sentAt: appt.clinicLabReferral?.sentAt || appt.createdAt
            };
        });

        return res.status(200).json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            count: data.length,
            data
        });
    } catch (error) {
        console.error("Get Clinic Lab Doctor Referrals Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 10. GET SINGLE DOCTOR-REFERRED LAB REQUEST DETAIL (Read-Only)
// @route   GET /api/clinic/lab/doctor-referrals/:appointmentId
// @access  Private (Clinic or Clinic Lab)
// ==========================================
const getClinicLabDoctorReferralById = async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        const { appointmentId } = req.params;

        const idQuery = mongoose.Types.ObjectId.isValid(appointmentId)
            ? { $or: [{ _id: appointmentId }, { bookingId: appointmentId }] }
            : { bookingId: appointmentId };

        let clinicId = userRole === 'clinic' ? req.user.id : (req.user.clinicId || null);

        const appointment = await Appointment.findOne({
            $and: [
                idQuery,
                ...(clinicId ? [{ clinicId }] : []),
                { 'clinicLabReferral.status': { $ne: 'None' } }
            ]
        })
            .select('_id bookingId bookingType tokenNumber formattedToken appointmentDate appointmentTime patients userId doctorId clinicalSummary clinicLabReferral')
            .populate('userId', 'name phone email gender age')
            .populate('doctorId', 'name speciality qualification cabinNumber profileImage')
            .populate('clinicLabReferral.sentBy', 'name speciality cabinNumber')
            .lean();

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Lab test referral not found."
            });
        }

        return res.status(200).json({
            success: true,
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    addClinicLab,
    getMyClinicLabs,
    getSingleClinicLab,
    updateClinicLab,
    toggleClinicLabStatus,
    deleteClinicLab,
    getClinicLabTimings,
    updateClinicLabTimings,
    getClinicLabDoctorReferrals,
    getClinicLabDoctorReferralById
};