// controllers/clinic/clinicPharmacyController.js
const Pharmacy = require('../../models/Pharmacy');
const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const { deleteFile } = require('../../utils/fileHandler');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// ==========================================
// 1. ADD CLINIC PHARMACY (With Strict 1-Pharmacy Check & Timings)
// Endpoint: POST /api/clinic/pharmacy/add
// ==========================================
const addClinicPharmacy = async (req, res) => {
    try {
        const clinicId = req.user.id; // From protect('clinic')
        const files = req.files || {};

        // 🛡️ 1. STRICT CHECK: Ek clinic sirf 1 hi pharmacy bana sakti hai (jab tak delete na ho jaye)
        const existingClinicPharmacy = await Pharmacy.findOne({ clinicId, isClinic: true });
        if (existingClinicPharmacy) {
            // Disk Cleanup for uploaded files
            if (files.profileImage) deleteFile(`/uploads/pharmacies/${files.profileImage[0].filename}`);
            if (files.signatureImage) deleteFile(`/uploads/pharmacies/${files.signatureImage[0].filename}`);
            ['pharmacyImages', 'pharmacyCertificates', 'pharmacyLicenses', 'gstCertificates', 'drugLicenses', 'otherCertificates'].forEach(key => {
                if (files[key]) files[key].forEach(f => deleteFile(`/uploads/pharmacies/${f.filename}`));
            });

            return res.status(400).json({
                success: false,
                message: "A Pharmacy is already registered for this clinic facility. You cannot create another pharmacy unless the existing one is deleted."
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
            isHomeDeliveryAvailable = true,
            is24x7 = false,

            // ⏰ Timings & Holiday
            openingTime = "09:00 AM",
            closeTime = "09:00 PM",
            holiday = "Sunday",

            // Legal & Regulatory Fields
            cinNumber = "",
            gstNumber = "",
            tanNumber = "",
            panNumber = "",
            drugLicenseNumber = "",
            foodLicenseNumber = "",
            documentState = "",
            issuingAuthority = "",
            drugLicenseType = "Retail",

            bankDetails
        } = req.body;

        // 2. Validations
        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: "Pharmacy Name and Phone Number are required."
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

        const existing = await Pharmacy.findOne({ $or: query });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "A pharmacy with this Email or Phone number already exists."
            });
        }

        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        // 4. Process Uploaded Files using pharmacyDocUploads
        const profileImagePath = files.profileImage?.[0] 
            ? `/uploads/pharmacies/${files.profileImage[0].filename}` 
            : null;

        const signatureImagePath = files.signatureImage?.[0] 
            ? `/uploads/pharmacies/${files.signatureImage[0].filename}` 
            : null;

        const documentsObj = {
            cinNumber,
            gstNumber,
            tanNumber,
            panNumber,
            drugLicenseNumber,
            foodLicenseNumber,
            documentState: documentState || state || "",
            issuingAuthority,
            drugLicenseType,
            signatureImage: signatureImagePath,
            pharmacyImages: files.pharmacyImages ? files.pharmacyImages.map(f => `/uploads/pharmacies/${f.filename}`) : [],
            pharmacyCertificates: files.pharmacyCertificates ? files.pharmacyCertificates.map(f => `/uploads/pharmacies/${f.filename}`) : [],
            pharmacyLicenses: files.pharmacyLicenses ? files.pharmacyLicenses.map(f => `/uploads/pharmacies/${f.filename}`) : [],
            gstCertificates: files.gstCertificates ? files.gstCertificates.map(f => `/uploads/pharmacies/${f.filename}`) : [],
            drugLicenses: files.drugLicenses ? files.drugLicenses.map(f => `/uploads/pharmacies/${f.filename}`) : [],
            otherCertificates: files.otherCertificates ? files.otherCertificates.map(f => `/uploads/pharmacies/${f.filename}`) : []
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

        const is24x7Bool = is24x7 === 'true' || is24x7 === true;

        // 6. Create Pharmacy with Pending status
        const newPharmacy = await Pharmacy.create({
            clinicId,
            isClinic: true,
            role: 'clinic-pharmacy',
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
            isHomeDeliveryAvailable: isHomeDeliveryAvailable === 'true' || isHomeDeliveryAvailable === true,
            is24x7: is24x7Bool,
            openingTime: is24x7Bool ? "12:00 AM" : openingTime,
            closeTime: is24x7Bool ? "11:59 PM" : closeTime,
            holiday: is24x7Bool ? "None" : holiday,

            profileImage: profileImagePath,
            documents: documentsObj,
            bankDetails: parsedBankDetails,

            profileStatus: 'Pending',
            isActive: true,
            isOnline: false
        });

        const clinicName = clinic.clinicName || clinic.name || "Clinic";

        // 7. Create Admin Approval Request
        await ProfileUpdateRequest.create({
            vendorId: newPharmacy._id,
            vendorModel: 'Pharmacy',
            updatedFields: {
                name: newPharmacy.name,
                email: newPharmacy.email,
                phone: newPharmacy.phone,
                clinicId: clinicId,
                clinicName: clinicName,
                address: newPharmacy.address,
                city: newPharmacy.city,
                state: newPharmacy.state,
                openingTime: newPharmacy.openingTime,
                closeTime: newPharmacy.closeTime,
                holiday: newPharmacy.holiday,
                is24x7: newPharmacy.is24x7,
                documents: documentsObj,
                profileImage: profileImagePath
            },
            status: 'Pending'
        });

        // 8. Notify Admins
        try {
            await notifyAdminsAndVendor(
                newPharmacy._id,
                'pharmacy',
                "New Clinic Pharmacy Approval Request",
                `${clinicName} has registered a Clinic Pharmacy (${newPharmacy.name}). Please review documents for approval.`
            );
        } catch (notifErr) {
            console.error("Admin Notification error on pharmacy registration:", notifErr.message);
        }

        const responseData = newPharmacy.toObject();
        delete responseData.password;

        res.status(201).json({
            success: true,
            message: `Clinic Pharmacy '${newPharmacy.name}' registered successfully and submitted to Admin for approval.`,
            profileStatus: 'Pending',
            data: responseData
        });

    } catch (error) {
        console.error("Add Clinic Pharmacy Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET ALL PHARMACIES OF LOGGED-IN CLINIC
// Endpoint: GET /api/clinic/pharmacy/my-pharmacies
// ==========================================
const getMyClinicPharmacies = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const pharmacies = await Pharmacy.find({ clinicId, isClinic: true })
            .select('-password -token -fcmToken')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: pharmacies.length,
            data: pharmacies
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET SINGLE CLINIC PHARMACY DETAILS
// Endpoint: GET /api/clinic/pharmacy/details/:id
// ==========================================
const getSingleClinicPharmacy = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const pharmacy = await Pharmacy.findOne({ _id: id, clinicId, isClinic: true })
            .select('-password -token -fcmToken');

        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Clinic pharmacy not found." });
        }

        res.json({
            success: true,
            data: pharmacy
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UPDATE CLINIC PHARMACY (Submits to Admin Approval Queue if already Approved)
// Endpoint: PUT /api/clinic/pharmacy/update/:id
// ==========================================
const updateClinicPharmacy = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = { ...req.body };

        const pharmacy = await Pharmacy.findOne({ _id: id, clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy not found or unauthorized." });
        }

        // Security parameters exclusion
        delete updates.password;
        delete updates.role;
        delete updates.isClinic;
        delete updates.clinicId;
        delete updates.token;
        delete updates.fcmToken;
        delete updates.rejectionReason;

        // Check Unique Email / Phone if updating
        if (updates.email && updates.email.toLowerCase() !== pharmacy.email) {
            const emailExists = await Pharmacy.findOne({ _id: { $ne: id }, email: updates.email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "Email is already registered with another pharmacy." });
            }
            updates.email = updates.email.toLowerCase();
        }

        if (updates.phone && updates.phone !== pharmacy.phone) {
            const phoneExists = await Pharmacy.findOne({ _id: { $ne: id }, phone: updates.phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: "Phone number is already in use." });
            }
        }

        // Documents handling
        const currentDocs = pharmacy.documents || {};
        const updatedDocs = {
            cinNumber: updates.cinNumber !== undefined ? updates.cinNumber : currentDocs.cinNumber,
            gstNumber: updates.gstNumber !== undefined ? updates.gstNumber : currentDocs.gstNumber,
            tanNumber: updates.tanNumber !== undefined ? updates.tanNumber : currentDocs.tanNumber,
            panNumber: updates.panNumber !== undefined ? updates.panNumber : currentDocs.panNumber,
            drugLicenseNumber: updates.drugLicenseNumber !== undefined ? updates.drugLicenseNumber : currentDocs.drugLicenseNumber,
            foodLicenseNumber: updates.foodLicenseNumber !== undefined ? updates.foodLicenseNumber : currentDocs.foodLicenseNumber,
            documentState: updates.documentState !== undefined ? updates.documentState : currentDocs.documentState,
            issuingAuthority: updates.issuingAuthority !== undefined ? updates.issuingAuthority : currentDocs.issuingAuthority,
            drugLicenseType: updates.drugLicenseType !== undefined ? updates.drugLicenseType : currentDocs.drugLicenseType,

            signatureImage: files.signatureImage?.[0]
                ? `/uploads/pharmacies/${files.signatureImage[0].filename}`
                : currentDocs.signatureImage,

            pharmacyImages: files.pharmacyImages
                ? files.pharmacyImages.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.pharmacyImages,

            pharmacyCertificates: files.pharmacyCertificates
                ? files.pharmacyCertificates.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.pharmacyCertificates,

            pharmacyLicenses: files.pharmacyLicenses
                ? files.pharmacyLicenses.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.pharmacyLicenses,

            gstCertificates: files.gstCertificates
                ? files.gstCertificates.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.gstCertificates,

            drugLicenses: files.drugLicenses
                ? files.drugLicenses.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.drugLicenses,

            otherCertificates: files.otherCertificates
                ? files.otherCertificates.map(f => `/uploads/pharmacies/${f.filename}`)
                : currentDocs.otherCertificates
        };

        if (files.profileImage?.[0]) {
            updates.profileImage = `/uploads/pharmacies/${files.profileImage[0].filename}`;
        }

        updates.documents = updatedDocs;

        if (updates.latitude !== undefined || updates.longitude !== undefined) {
            updates.location = {
                lat: updates.latitude ? Number(updates.latitude) : pharmacy.location?.lat || 0,
                lng: updates.longitude ? Number(updates.longitude) : pharmacy.location?.lng || 0
            };
        }

        if (typeof updates.bankDetails === 'string') {
            try { updates.bankDetails = JSON.parse(updates.bankDetails); } catch (e) {}
        }

        const clinic = await Clinic.findById(clinicId).select('name clinicName');
        const isApproved = pharmacy.profileStatus === 'Approved';

        // 🚨 CASE 1: ALREADY APPROVED -> Send Request to Admin for Approval
        if (isApproved) {
            // Delete previously pending update files to avoid disk bloat
            const existingPending = await ProfileUpdateRequest.findOne({
                vendorId: pharmacy._id,
                vendorModel: 'Pharmacy',
                status: 'Pending'
            });

            if (existingPending) {
                if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                    deleteFile(existingPending.updatedFields.profileImage);
                }
                await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
            }

            const request = await ProfileUpdateRequest.create({
                vendorId: pharmacy._id,
                vendorModel: 'Pharmacy',
                updatedFields: {
                    ...updates,
                    pharmacyId: pharmacy._id,
                    pharmacyName: pharmacy.name,
                    clinicId,
                    clinicName: clinic ? (clinic.clinicName || clinic.name) : "Clinic"
                },
                status: 'Pending'
            });

            // Notify Admin
            try {
                await notifyAdminsAndVendor(
                    pharmacy._id,
                    'pharmacy',
                    "Clinic Pharmacy Update Approval Request",
                    `${clinic ? (clinic.clinicName || clinic.name) : 'Clinic'} has submitted updated details for pharmacy '${pharmacy.name}'. Please review and approve.`
                );
            } catch (notifErr) {
                console.error("Admin notification error:", notifErr.message);
            }

            return res.json({
                success: true,
                message: `Profile update request for '${pharmacy.name}' submitted to Admin for approval.`,
                status: 'Pending',
                requestId: request._id,
                data: request
            });
        }

        // 🚨 CASE 2: FIRST-TIME ONBOARDING (Incomplete / Rejected / Pending State) -> Direct Update
        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
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
            message: "Clinic Pharmacy details updated and submitted for verification.",
            data: updatedPharmacy
        });

    } catch (error) {
        console.error("Update Clinic Pharmacy Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. TOGGLE PHARMACY ACTIVE/INACTIVE STATUS
// Endpoint: PATCH /api/clinic/pharmacy/toggle-status/:id
// ==========================================
const toggleClinicPharmacyStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const pharmacy = await Pharmacy.findOne({ _id: id, clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Clinic Pharmacy not found." });
        }

        pharmacy.isActive = !pharmacy.isActive;
        await pharmacy.save();

        res.json({
            success: true,
            message: `Pharmacy '${pharmacy.name}' is now ${pharmacy.isActive ? 'Active' : 'Inactive'}.`,
            isActive: pharmacy.isActive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. DELETE CLINIC PHARMACY
// Endpoint: DELETE /api/clinic/pharmacy/delete/:id
// ==========================================
const deleteClinicPharmacy = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const pharmacy = await Pharmacy.findOne({ _id: id, clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Clinic Pharmacy not found or unauthorized." });
        }

        // Disk Cleanup for Uploaded Documents
        if (pharmacy.profileImage) deleteFile(pharmacy.profileImage);
        if (pharmacy.documents) {
            const docFields = ['pharmacyImages', 'pharmacyCertificates', 'pharmacyLicenses', 'gstCertificates', 'drugLicenses', 'otherCertificates'];
            docFields.forEach(field => {
                if (Array.isArray(pharmacy.documents[field])) {
                    pharmacy.documents[field].forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
            if (pharmacy.documents.signatureImage) deleteFile(pharmacy.documents.signatureImage);
        }

        await Pharmacy.findByIdAndDelete(id);

        res.json({
            success: true,
            message: `Clinic Pharmacy '${pharmacy.name}' and all associated documents removed successfully.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// GET CLINIC PHARMACY TIMINGS
// Endpoint: GET /api/clinic/pharmacy/timings
// ==========================================
const getClinicPharmacyTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true })
            .select('name is24x7 openingTime closeTime holiday');

        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Clinic Pharmacy not found." });
        }

        res.json({
            success: true,
            data: {
                is24x7: pharmacy.is24x7,
                openingTime: pharmacy.openingTime || "09:00 AM",
                closeTime: pharmacy.closeTime || "09:00 PM",
                holiday: pharmacy.holiday || "Sunday",
                displayTiming: pharmacy.is24x7 ? "Open 24x7" : `${pharmacy.openingTime} - ${pharmacy.closeTime}`
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// SET / UPDATE CLINIC PHARMACY TIMINGS
// Endpoint: PUT /api/clinic/pharmacy/timings
// ==========================================
const updateClinicPharmacyTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { is24x7, openingTime, closeTime, holiday } = req.body;

        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Clinic Pharmacy not found." });
        }

        const is24x7Bool = is24x7 === true || is24x7 === 'true';

        pharmacy.is24x7 = is24x7Bool;
        pharmacy.openingTime = is24x7Bool ? "12:00 AM" : (openingTime || pharmacy.openingTime || "09:00 AM");
        pharmacy.closeTime = is24x7Bool ? "11:59 PM" : (closeTime || pharmacy.closeTime || "09:00 PM");
        pharmacy.holiday = is24x7Bool ? "None" : (holiday || pharmacy.holiday || "Sunday");

        await pharmacy.save();

        res.json({
            success: true,
            message: "Clinic Pharmacy timings updated successfully.",
            data: {
                is24x7: pharmacy.is24x7,
                openingTime: pharmacy.openingTime,
                closeTime: pharmacy.closeTime,
                holiday: pharmacy.holiday
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    addClinicPharmacy,
    getMyClinicPharmacies,
    getSingleClinicPharmacy,
    updateClinicPharmacy,
    toggleClinicPharmacyStatus,
    deleteClinicPharmacy,
    getClinicPharmacyTimings,
    updateClinicPharmacyTimings
};