// controllers/clinic/clinicDoctorController.js
const Doctor = require('../../models/Doctor');
const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const { deleteFile } = require('../../utils/fileHandler');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// ==========================================
// 1. REGISTER NEW CLINIC DOCTOR (Sends to Admin for Approval)
// Endpoint: POST /api/clinic/doctors/add
// ==========================================
const addClinicDoctor = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const files = req.files || {};
        
        const {
            name,
            email,
            phone,
            altPhone,
            gender,
            specialist,
            experience,
            
            // --- 3-WAY CONSULTATION FEES ---
            clinicFee = 0,
            onlineFee = 0,
            homeFee = 0,

            // 🚨 3-WAY DIRECT AVAILABILITY TOGGLES
            isClinicAvailable = true,
            isOnlineAvailable = true,
            isHomeAvailable = false,

            // --- PRIMARY REGISTRATION DETAILS ---
            licenseNumber,
            councilName,
            councilNumber,
            stateName,

            // --- LOCATION DETAILS ---
            address,
            city,
            state,
            pincode,
            latitude,
            longitude,
            password,

            // --- DYNAMIC QUALIFICATIONS (JSON String Array) ---
            qualifications
        } = req.body;

        // 1. Basic Validations
        if (!name || !phone || !specialist) {
            return res.status(400).json({
                success: false,
                message: "Doctor Name, Phone number, and Specialization are required."
            });
        }

        // 2. Duplicate Check
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });

        const existingDoctor = await Doctor.findOne({ $or: query });
        if (existingDoctor) {
            return res.status(400).json({
                success: false,
                message: "A doctor with this Email or Phone number already exists."
            });
        }

        // 3. Process File Uploads
        const profileImagePath = files.profileImage?.[0] 
            ? `/uploads/doctors/${files.profileImage[0].filename}` 
            : null;

        const signatureImagePath = files.signature?.[0] 
            ? `/uploads/doctors/${files.signature[0].filename}` 
            : null;

        const documentPaths = [];
        if (files.licenseCert?.[0]) {
            documentPaths.push(`/uploads/doctors/${files.licenseCert[0].filename}`);
        }
        if (files.idProof?.[0]) {
            documentPaths.push(`/uploads/doctors/${files.idProof[0].filename}`);
        }
        if (files.degreeCertificates && files.degreeCertificates.length > 0) {
            files.degreeCertificates.forEach(f => {
                documentPaths.push(`/uploads/doctors/${f.filename}`);
            });
        }

        // 4. Parse Qualifications JSON
        let parsedQualifications = [];
        let primaryDegreeString = "MBBS";

        if (qualifications) {
            try {
                parsedQualifications = typeof qualifications === 'string' 
                    ? JSON.parse(qualifications) 
                    : qualifications;

                if (Array.isArray(parsedQualifications) && parsedQualifications.length > 0) {
                    primaryDegreeString = parsedQualifications.map(q => q.degree).filter(Boolean).join(', ');
                }
            } catch (err) {
                console.warn("Could not parse qualifications JSON, defaulting.");
            }
        }

        // 5. Parse Availability Booleans
        const clinicAvail = isClinicAvailable === 'true' || isClinicAvailable === true;
        const onlineAvail = isOnlineAvailable === 'true' || isOnlineAvailable === true;
        const homeAvail = isHomeAvailable === 'true' || isHomeAvailable === true;

        // 6. Default Password Hash
        const rawPassword = password || phone || 'Doctor@123';
        const hashedPassword = await bcrypt.hash(String(rawPassword), 10);

        // 7. Create Doctor Record with 'Pending' Status
        const newDoctor = await Doctor.create({
            clinicId: clinicId,
            name: name.startsWith('Dr.') ? name : `Dr. ${name}`,
            email: email ? email.toLowerCase() : undefined,
            phone,
            alternatePhone: altPhone || null,
            password: hashedPassword,
            role: 'clinic-doctor',
            gender: gender || 'Male',

            // Location
            address: address || null,
            city: city || null,
            state: state || stateName || null,
            pincode: pincode || null,
            country: 'India',
            location: {
                lat: latitude ? Number(latitude) : 0,
                lng: longitude ? Number(longitude) : 0
            },

            // Professional Profile & Registration Details
            speciality: specialist,
            qualification: primaryDegreeString,
            qualifications: parsedQualifications,
            experienceYears: experience ? Number(experience) : 0,
            licenseNumber: licenseNumber || councilNumber || "",
            councilNumber: councilNumber || licenseNumber || "",
            councilName: councilName || "",

            // 🚀 3-WAY CONSULTATION FEES
            fees: {
                clinic: Number(clinicFee),
                online: Number(onlineFee),
                home: Number(homeFee)
            },

            // 🚨 DIRECT AVAILABILITY BOOLEAN KEYS
            isClinicAvailable: clinicAvail,
            isOnlineAvailable: onlineAvail,
            isHomeAvailable: homeAvail,

            consultationStatus: {
                clinic: clinicAvail,
                online: onlineAvail,
                home: homeAvail
            },

            // Media
            profileImage: profileImagePath,
            signatureImage: signatureImagePath,
            documents: documentPaths,

            profileStatus: 'Pending',
            dutyStatus: 'Off Duty',
            isActive: true,
            isOnline: false
        });

        // 8. Link Doctor into Clinic model
        const clinic = await Clinic.findByIdAndUpdate(
            clinicId, 
            { $addToSet: { DoctorId: newDoctor._id } },
            { new: true }
        );

        // 9. Create Admin Approval Request
        await ProfileUpdateRequest.create({
            vendorId: newDoctor._id,
            vendorModel: 'Doctor',
            updatedFields: {
                name: newDoctor.name,
                email: newDoctor.email,
                phone: newDoctor.phone,
                speciality: newDoctor.speciality,
                qualification: newDoctor.qualification,
                qualifications: parsedQualifications,
                fees: newDoctor.fees,
                isClinicAvailable: clinicAvail,
                isOnlineAvailable: onlineAvail,
                isHomeAvailable: homeAvail,
                licenseNumber: newDoctor.licenseNumber,
                councilName: newDoctor.councilName,
                clinicId: clinicId,
                clinicName: clinic ? clinic.clinicName || clinic.name : "Clinic",
                profileImage: profileImagePath,
                documents: documentPaths
            },
            status: 'Pending'
        });

        // 10. Notify Admin
        try {
            await notifyAdminsAndVendor(
                newDoctor._id,
                'doctor',
                "New Clinic Doctor Approval Request",
                `${clinic ? clinic.clinicName : 'Clinic'} has registered Dr. ${newDoctor.name}. Please review credentials for approval.`
            );
        } catch (notifErr) {
            console.error("Admin Notification error:", notifErr.message);
        }

        res.status(201).json({
            success: true,
            message: `${newDoctor.name} has been registered successfully and submitted to Admin for approval.`,
            profileStatus: 'Pending',
            data: newDoctor
        });

    } catch (error) {
        console.error("Add Clinic Doctor Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to register doctor"
        });
    }
};

// ==========================================
// 2. GET ALL DOCTORS OF CLINIC
// Endpoint: GET /api/clinic/doctors/my-doctors
// ==========================================
const getMyClinicDoctors = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const doctors = await Doctor.find({ clinicId }).sort({ createdAt: -1 });

        res.json({
            success: true,
            count: doctors.length,
            data: doctors
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. UPDATE CLINIC DOCTOR (Sends Update Request to Admin for Approval)
// Endpoint: PUT /api/clinic/doctors/update/:id
// ==========================================
const updateClinicDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = req.body || {};

        // 1. Verify Doctor belongs to this logged-in clinic
        const doctor = await Doctor.findOne({ _id: id, clinicId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found or unauthorized in your clinic."
            });
        }

        // 2. Email Uniqueness Check
        if (updates.email && updates.email.toLowerCase() !== doctor.email) {
            const emailExists = await Doctor.findOne({ _id: { $ne: id }, email: updates.email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "This email is already in use by another doctor." });
            }
        }

        // 3. Phone Uniqueness Check
        if (updates.phone && updates.phone !== doctor.phone) {
            const phoneExists = await Doctor.findOne({ _id: { $ne: id }, phone: updates.phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: "This phone number is already registered with another doctor." });
            }
        }

        // 4. Collect Proposed Updates Object
        const proposedUpdates = {};

        // Basic Info
        if (updates.name) proposedUpdates.name = updates.name.startsWith('Dr.') ? updates.name : `Dr. ${updates.name}`;
        if (updates.email) proposedUpdates.email = updates.email.toLowerCase();
        if (updates.phone) proposedUpdates.phone = updates.phone;
        if (updates.altPhone !== undefined) proposedUpdates.alternatePhone = updates.altPhone;
        if (updates.gender) proposedUpdates.gender = updates.gender;
        if (updates.specialist) proposedUpdates.speciality = updates.specialist;
        if (updates.experience !== undefined) proposedUpdates.experienceYears = Number(updates.experience);
        
        // Registration & License
        if (updates.licenseNumber) proposedUpdates.licenseNumber = updates.licenseNumber;
        if (updates.councilName !== undefined) proposedUpdates.councilName = updates.councilName;
        if (updates.councilNumber !== undefined) proposedUpdates.councilNumber = updates.councilNumber;

        // Address & Location
        if (updates.address !== undefined) proposedUpdates.address = updates.address;
        if (updates.city !== undefined) proposedUpdates.city = updates.city;
        if (updates.state !== undefined) proposedUpdates.state = updates.state;
        if (updates.pincode !== undefined) proposedUpdates.pincode = updates.pincode;

        if (updates.latitude !== undefined || updates.longitude !== undefined) {
            proposedUpdates.location = {
                lat: updates.latitude ? Number(updates.latitude) : doctor.location?.lat || 0,
                lng: updates.longitude ? Number(updates.longitude) : doctor.location?.lng || 0
            };
        }

        // 3-Way Fees
        if (updates.clinicFee !== undefined || updates.onlineFee !== undefined || updates.homeFee !== undefined) {
            proposedUpdates.fees = {
                clinic: updates.clinicFee !== undefined ? Number(updates.clinicFee) : doctor.fees?.clinic || 0,
                online: updates.onlineFee !== undefined ? Number(updates.onlineFee) : doctor.fees?.online || 0,
                home: updates.homeFee !== undefined ? Number(updates.homeFee) : doctor.fees?.home || 0
            };
        }

        // 🚨 DIRECT AVAILABILITY BOOLEAN KEYS UPDATE
        if (updates.isClinicAvailable !== undefined) {
            proposedUpdates.isClinicAvailable = (updates.isClinicAvailable === 'true' || updates.isClinicAvailable === true);
        }
        if (updates.isOnlineAvailable !== undefined) {
            proposedUpdates.isOnlineAvailable = (updates.isOnlineAvailable === 'true' || updates.isOnlineAvailable === true);
        }
        if (updates.isHomeAvailable !== undefined) {
            proposedUpdates.isHomeAvailable = (updates.isHomeAvailable === 'true' || updates.isHomeAvailable === true);
        }

        // Sync consultationStatus
        if (updates.isClinicAvailable !== undefined || updates.isOnlineAvailable !== undefined || updates.isHomeAvailable !== undefined) {
            proposedUpdates.consultationStatus = {
                clinic: updates.isClinicAvailable !== undefined ? (updates.isClinicAvailable === 'true' || updates.isClinicAvailable === true) : doctor.isClinicAvailable,
                online: updates.isOnlineAvailable !== undefined ? (updates.isOnlineAvailable === 'true' || updates.isOnlineAvailable === true) : doctor.isOnlineAvailable,
                home: updates.isHomeAvailable !== undefined ? (updates.isHomeAvailable === 'true' || updates.isHomeAvailable === true) : doctor.isHomeAvailable
            };
        }

        // Qualifications Parsing
        if (updates.qualifications) {
            try {
                const parsedQualifications = typeof updates.qualifications === 'string'
                    ? JSON.parse(updates.qualifications)
                    : updates.qualifications;

                if (Array.isArray(parsedQualifications) && parsedQualifications.length > 0) {
                    proposedUpdates.qualification = parsedQualifications.map(q => q.degree).filter(Boolean).join(', ');
                    proposedUpdates.qualifications = parsedQualifications;
                }
            } catch (err) {
                console.warn("Qualifications parse error:", err.message);
            }
        }

        // Password change (if provided)
        if (updates.password) {
            proposedUpdates.password = await bcrypt.hash(String(updates.password), 10);
        }

        // File Upload Handling
        if (files.profileImage && files.profileImage.length > 0) {
            proposedUpdates.profileImage = `/uploads/doctors/${files.profileImage[0].filename}`;
        }

        if (files.signature && files.signature.length > 0) {
            proposedUpdates.signatureImage = `/uploads/doctors/${files.signature[0].filename}`;
        }

        // Documents array
        const updatedDocuments = [...(doctor.documents || [])];
        if (files.licenseCert && files.licenseCert.length > 0) {
            updatedDocuments.push(`/uploads/doctors/${files.licenseCert[0].filename}`);
        }
        if (files.idProof && files.idProof.length > 0) {
            updatedDocuments.push(`/uploads/doctors/${files.idProof[0].filename}`);
        }
        if (files.degreeCertificates && files.degreeCertificates.length > 0) {
            files.degreeCertificates.forEach(f => {
                updatedDocuments.push(`/uploads/doctors/${f.filename}`);
            });
        }
        if (updatedDocuments.length > 0) {
            proposedUpdates.documents = updatedDocuments;
        }

        // Clinic details
        const clinic = await Clinic.findById(clinicId).select('name clinicName');

        // 🚀 5. CREATE OR UPDATE PENDING APPROVAL REQUEST
        const approvalRequest = await ProfileUpdateRequest.findOneAndUpdate(
            { 
                vendorId: doctor._id, 
                vendorModel: 'Doctor', 
                status: 'Pending' 
            },
            {
                $set: {
                    updatedFields: {
                        ...proposedUpdates, // 👈 isClinicAvailable, isOnlineAvailable, isHomeAvailable included here
                        doctorId: doctor._id,
                        doctorCurrentName: doctor.name,
                        clinicId: clinicId,
                        clinicName: clinic ? (clinic.clinicName || clinic.name) : "Clinic"
                    },
                    status: 'Pending',
                    rejectionReason: ""
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        // 6. Notify Admin
        try {
            await notifyAdminsAndVendor(
                doctor._id,
                'doctor',
                "Clinic Doctor Update Approval Request",
                `${clinic ? (clinic.clinicName || clinic.name) : 'Clinic'} has submitted updated details for Dr. ${doctor.name}. Please review and approve.`
            );
        } catch (notifErr) {
            console.error("Admin notification error:", notifErr.message);
        }

        res.status(200).json({
            success: true,
            message: `Profile update request for Dr. ${doctor.name} has been submitted to Admin for approval.`,
            status: 'Pending',
            requestId: approvalRequest._id,
            data: {
                doctorId: doctor._id,
                doctorName: doctor.name,
                proposedUpdates: approvalRequest.updatedFields
            }
        });

    } catch (error) {
        console.error("Update Clinic Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to submit update request." });
    }
};

// ==========================================
// 4. TOGGLE DOCTOR DUTY STATUS
// ==========================================
const toggleDoctorDutyStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { dutyStatus } = req.body;

        const doctor = await Doctor.findOneAndUpdate(
            { _id: id, clinicId: req.user.id },
            { $set: { dutyStatus } },
            { new: true }
        );

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in your clinic." });
        }

        res.json({
            success: true,
            message: `Dr. ${doctor.name} is now ${dutyStatus}`,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. REMOVE DOCTOR FROM CLINIC
// ==========================================
const removeClinicDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const doctor = await Doctor.findOneAndDelete({ _id: id, clinicId });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or unauthorized." });
        }

        await Clinic.findByIdAndUpdate(clinicId, {
            $pull: { DoctorId: id }
        });

        res.json({
            success: true,
            message: "Doctor removed from clinic successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    addClinicDoctor,
    getMyClinicDoctors,
    updateClinicDoctor,
    toggleDoctorDutyStatus,
    removeClinicDoctor
};