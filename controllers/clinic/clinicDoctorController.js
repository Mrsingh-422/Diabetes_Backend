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
            isClinicAvailable = true,
            isOnlineAvailable = true,
            isHomeAvailable = true,

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

        // 4. Parse Qualifications JSON (with Council, Reg No & State Name)
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

        // 5. Default Password Hash
        const rawPassword = password || phone || 'Doctor@123';
        const hashedPassword = await bcrypt.hash(String(rawPassword), 10);

        // 6. Create Doctor Record with 'Pending' Status
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
            qualifications: parsedQualifications, // Includes councilName, registrationNo, stateName
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
            consultationStatus: {
                clinic: isClinicAvailable === 'true' || isClinicAvailable === true,
                online: isOnlineAvailable === 'true' || isOnlineAvailable === true,
                home: isHomeAvailable === 'true' || isHomeAvailable === true
            },

            // Media
            profileImage: profileImagePath,
            signatureImage: signatureImagePath,
            documents: documentPaths,

            // 🚨 STATUS: PENDING FOR ADMIN APPROVAL
            profileStatus: 'Pending',
            dutyStatus: 'Off Duty',
            isActive: true,
            isOnline: false
        });

        // 7. Link Doctor into Clinic model's DoctorId array
        const clinic = await Clinic.findByIdAndUpdate(
            clinicId, 
            { $addToSet: { DoctorId: newDoctor._id } },
            { new: true }
        );

        // 8. 🚀 CREATE ADMIN APPROVAL REQUEST
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
                licenseNumber: newDoctor.licenseNumber,
                councilName: newDoctor.councilName,
                clinicId: clinicId,
                clinicName: clinic ? clinic.clinicName || clinic.name : "Clinic",
                profileImage: profileImagePath,
                documents: documentPaths
            },
            status: 'Pending'
        });

        // 9. 🔔 NOTIFY ADMINS ABOUT NEW DOCTOR VERIFICATION
        try {
            await notifyAdminsAndVendor(
                newDoctor._id,
                'doctor',
                "New Clinic Doctor Approval Request",
                `${clinic ? clinic.clinicName : 'Clinic'} has registered Dr. ${newDoctor.name}. Please review credentials for approval.`
            );
        } catch (notifErr) {
            console.error("Admin Notification error for doctor creation:", notifErr.message);
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
// 3. UPDATE CLINIC DOCTOR
// Endpoint: PUT /api/clinic/doctors/update/:id
// ==========================================
const updateClinicDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = { ...req.body };

        const doctor = await Doctor.findOne({ _id: id, clinicId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found or unauthorized in your clinic."
            });
        }

        // Email uniqueness
        if (updates.email && updates.email.toLowerCase() !== doctor.email) {
            const emailExists = await Doctor.findOne({ _id: { $ne: id }, email: updates.email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "This email is already in use." });
            }
            doctor.email = updates.email.toLowerCase();
        }

        // Phone uniqueness
        if (updates.phone && updates.phone !== doctor.phone) {
            const phoneExists = await Doctor.findOne({ _id: { $ne: id }, phone: updates.phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: "This phone number is already registered." });
            }
            doctor.phone = updates.phone;
        }

        // Basic Info
        if (updates.name) doctor.name = updates.name.startsWith('Dr.') ? updates.name : `Dr. ${updates.name}`;
        if (updates.altPhone !== undefined) doctor.alternatePhone = updates.altPhone;
        if (updates.gender) doctor.gender = updates.gender;
        if (updates.specialist) doctor.speciality = updates.specialist;
        if (updates.experience !== undefined) doctor.experienceYears = Number(updates.experience);
        if (updates.licenseNumber) doctor.licenseNumber = updates.licenseNumber;
        if (updates.councilName !== undefined) doctor.councilName = updates.councilName;
        if (updates.councilNumber !== undefined) doctor.councilNumber = updates.councilNumber;
        if (updates.address !== undefined) doctor.address = updates.address;
        if (updates.city !== undefined) doctor.city = updates.city;
        if (updates.state !== undefined) doctor.state = updates.state;
        if (updates.pincode !== undefined) doctor.pincode = updates.pincode;

        // 3-Way Fees Update
        if (updates.clinicFee !== undefined || updates.onlineFee !== undefined || updates.homeFee !== undefined) {
            doctor.fees = {
                clinic: updates.clinicFee !== undefined ? Number(updates.clinicFee) : doctor.fees?.clinic || 0,
                online: updates.onlineFee !== undefined ? Number(updates.onlineFee) : doctor.fees?.online || 0,
                home: updates.homeFee !== undefined ? Number(updates.homeFee) : doctor.fees?.home || 0
            };
        }

        // Location GPS
        if (updates.latitude !== undefined || updates.longitude !== undefined) {
            doctor.location = {
                lat: updates.latitude ? Number(updates.latitude) : doctor.location?.lat || 0,
                lng: updates.longitude ? Number(updates.longitude) : doctor.location?.lng || 0
            };
        }

        // Password change
        if (updates.password) {
            doctor.password = await bcrypt.hash(String(updates.password), 10);
        }

        // Qualifications with Council & State Details
        if (updates.qualifications) {
            try {
                const parsedQualifications = typeof updates.qualifications === 'string'
                    ? JSON.parse(updates.qualifications)
                    : updates.qualifications;

                if (Array.isArray(parsedQualifications) && parsedQualifications.length > 0) {
                    doctor.qualification = parsedQualifications.map(q => q.degree).filter(Boolean).join(', ');
                    doctor.qualifications = parsedQualifications;
                }
            } catch (err) {
                console.warn("Qualifications parse error:", err.message);
            }
        }

        // File replacements & disk cleanup
        if (files.profileImage && files.profileImage.length > 0) {
            if (doctor.profileImage) deleteFile(doctor.profileImage);
            doctor.profileImage = `/uploads/doctors/${files.profileImage[0].filename}`;
        }

        if (files.signature && files.signature.length > 0) {
            if (doctor.signatureImage) deleteFile(doctor.signatureImage);
            doctor.signatureImage = `/uploads/doctors/${files.signature[0].filename}`;
        }

        if (files.licenseCert && files.licenseCert.length > 0) {
            doctor.documents.push(`/uploads/doctors/${files.licenseCert[0].filename}`);
        }
        if (files.idProof && files.idProof.length > 0) {
            doctor.documents.push(`/uploads/doctors/${files.idProof[0].filename}`);
        }
        if (files.degreeCertificates && files.degreeCertificates.length > 0) {
            files.degreeCertificates.forEach(f => {
                doctor.documents.push(`/uploads/doctors/${f.filename}`);
            });
        }

        await doctor.save();

        res.json({
            success: true,
            message: `Dr. ${doctor.name.replace(/^Dr\.\s*/, '')} details updated successfully.`,
            data: doctor
        });

    } catch (error) {
        console.error("Update Clinic Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message });
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