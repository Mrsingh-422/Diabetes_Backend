// controllers/clinic/clinicDoctorController.js
const mongoose = require('mongoose');
const Doctor = require('../../models/Doctor');
const Clinic = require('../../models/Clinic');
const Appointment = require('../../models/Appointment');
const Availability = require('../../models/Availability');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const moment = require('moment');
const { generateTimeSlots } = require('../../utils/timeSlotHelper');
const { notifyAdminsAndVendor, sendPushNotification } = require('../../utils/notification');


// Helper: Generate JWT Token (Same as authClinic & clinicAmbulance)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};
// ==========================================
// 6. LOGIN CLINIC DOCTOR (Public)
// Endpoint: POST /api/clinic/doctors/login
// ==========================================
const loginClinicDoctor = async (req, res) => {
    try {
        const { email, phone, identifier, password, fcmToken } = req.body || {};

        // 1. Build Login Identifier Query (Supports email, phone, or identifier)
        let query = {};
        if (email) {
            query = { email: String(email).toLowerCase().trim() };
        } else if (phone) {
            query = { phone: String(phone).trim() };
        } else if (identifier) {
            const cleanId = String(identifier).trim();
            query = {
                $or: [
                    { email: cleanId.toLowerCase() },
                    { phone: cleanId }
                ]
            };
        } else {
            return res.status(400).json({
                success: false,
                message: "Email or Phone number is required."
            });
        }

        if (!password) {
            return res.status(400).json({
                success: false,
                message: "Password is required."
            });
        }

        // 2. Find Doctor & Verify Password
        const doctor = await Doctor.findOne(query).select('+password');
        if (!doctor || !doctor.password || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({
                success: false,
                message: "Invalid Credentials"
            });
        }

        // 3. Ensure Doctor belongs to a Clinic ('clinic-doctor')
        if (doctor.role !== 'clinic-doctor' && !doctor.clinicId) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: This account is not registered as a clinic doctor."
            });
        }

        // 4. Account Active Check
        if (doctor.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: Your doctor account is inactive. Please contact your clinic or administrator."
            });
        }

        // 5. Associated Clinic Check
        let clinicInfo = null;
        if (doctor.clinicId) {
            clinicInfo = await Clinic.findById(doctor.clinicId)
                .select('name clinicName email phoneNumber address city state image posterimage isActive Accountverify profileStatus')
                .lean();

            if (clinicInfo && clinicInfo.isActive === false) {
                return res.status(403).json({
                    success: false,
                    message: "Access Denied: Your associated clinic account is currently inactive."
                });
            }
        }

        // 6. Profile Approval Status Check (Same flow as authClinic.js)
        if (doctor.profileStatus === 'Pending') {
            return res.status(200).json({
                success: true,
                fullAccess: false,
                profileStatus: 'Pending',
                message: "Your profile is under review. Please wait for Admin approval."
            });
        }

        if (doctor.profileStatus === 'Incomplete') {
            return res.status(200).json({
                success: true,
                fullAccess: false,
                profileStatus: 'Incomplete',
                message: "Profile is incomplete. Please contact your clinic to complete verification."
            });
        }

        if (doctor.profileStatus === 'Rejected') {
            return res.status(200).json({
                success: true,
                fullAccess: false,
                profileStatus: 'Rejected',
                rejectionReason: doctor.rejectionReason || "No specific reason provided.",
                message: `Application Rejected: ${doctor.rejectionReason || "Please contact your clinic administrator."}`
            });
        }

        // 7. Generate or Reuse JWT Token (Development Mode safe)
        let token = null;
        if (process.env.NODE_ENV === 'development' && doctor.token) {
            try {
                jwt.verify(doctor.token, process.env.JWT_SECRET);
                token = doctor.token;
            } catch (err) {
                token = null;
            }
        }

        if (!token) {
            token = generateToken(doctor._id, doctor.role || 'clinic-doctor');
            doctor.token = token;
        }

        if (fcmToken) {
            doctor.fcmToken = fcmToken;
        }

        await doctor.save();

        const responseData = doctor.toObject();
        delete responseData.password;
        responseData.clinicDetails = clinicInfo;

        return res.status(200).json({
            success: true,
            fullAccess: true,
            message: "Login successful",
            token,
            role: doctor.role,
            profileStatus: doctor.profileStatus,
            data: responseData
        });

    } catch (error) {
        console.error("Login Clinic Doctor Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

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

// ==========================================
// 7. CLINIC ASSIGNS APPOINTMENT TO CLINIC DOCTOR (Generates OPD Token if Missing)
// ==========================================
const assignAppointmentToClinicDoctor = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            appointmentId,
            doctorId,
            appointmentDate,
            appointmentTime,
            notes
        } = req.body || {};

        if (!appointmentId || !doctorId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId and doctorId are required."
            });
        }

        if (!mongoose.Types.ObjectId.isValid(doctorId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid doctorId format."
            });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, clinicId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found in your clinic."
            });
        }

        if (doctor.isActive === false) {
            return res.status(400).json({
                success: false,
                message: `${doctor.name} account is currently inactive.`
            });
        }

        if (doctor.profileStatus !== 'Approved') {
            return res.status(400).json({
                success: false,
                message: `${doctor.name} profile is '${doctor.profileStatus}'. Only Approved doctors can be assigned appointments.`
            });
        }

        if (['Busy', 'Off Duty', 'On Leave'].includes(doctor.dutyStatus)) {
            return res.status(400).json({
                success: false,
                message: `${doctor.name} is currently '${doctor.dutyStatus}' and cannot be assigned.`
            });
        }

        const apptQuery = mongoose.Types.ObjectId.isValid(appointmentId)
            ? { $or: [{ _id: appointmentId }, { bookingId: appointmentId }], clinicId }
            : { bookingId: appointmentId, clinicId };

        const appointment = await Appointment.findOne(apptQuery);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or does not belong to your clinic."
            });
        }

        const blockedStatuses = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'];
        if (blockedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot assign doctor because appointment is already '${appointment.status}'.`
            });
        }

        const now = new Date();
        const previousDoctorId = appointment.doctorId ? appointment.doctorId.toString() : null;
        const hasHistory = Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0;
        const isSwitchingDoctor = Boolean(previousDoctorId && previousDoctorId !== doctor._id.toString());

        if (isSwitchingDoctor) {
            const historyArr = appointment.treatmentHistory || [];
            for (let i = historyArr.length - 1; i >= 0; i--) {
                if (!historyArr[i].endTime) {
                    historyArr[i].endTime = now;
                    historyArr[i].acceptanceStatus = historyArr[i].acceptanceStatus === 'Pending-Acceptance'
                        ? 'Unaccepted-Reassigned'
                        : 'Replaced-After-Acceptance';
                    if (historyArr[i].startTime) {
                        const diffMins = Math.max(0, Math.floor((now - new Date(historyArr[i].startTime)) / 60000));
                        const hrs = Math.floor(diffMins / 60);
                        const mins = diffMins % 60;
                        historyArr[i].durationDisplay = hrs > 0 ? `${hrs} hr ${mins} mins` : `${mins} mins`;
                    }
                    break;
                }
            }
        }

        if (!previousDoctorId || !hasHistory) {
            appointment.treatmentHistory.push({
                fromDoctorId: null,
                toDoctorId: doctor._id,
                action: 'Initial-Assignment',
                acceptanceStatus: 'Pending-Acceptance',
                assignedAt: now,
                notes: notes || (previousDoctorId === doctor._id.toString()
                    ? `User-selected doctor (${doctor.name}) confirmed & assigned by Clinic`
                    : `Assigned to ${doctor.name} by Clinic`),
                startTime: now
            });
        } else if (isSwitchingDoctor) {
            appointment.treatmentHistory.push({
                fromDoctorId: appointment.doctorId,
                toDoctorId: doctor._id,
                action: 'Transfer-Accepted',
                acceptanceStatus: 'Pending-Acceptance',
                assignedAt: now,
                notes: notes || `Reassigned to ${doctor.name} by Clinic`,
                startTime: now
            });
        }

        appointment.doctorId = doctor._id;
        appointment.pendingDoctorId = null;
        appointment.doctorAcceptanceStatus = 'Pending';
        appointment.doctorRejectionReason = "";
        appointment.doctorRespondedAt = null;

        if (appointmentDate) {
            appointment.appointmentDate = new Date(appointmentDate);
        }
        if (appointmentTime) {
            appointment.appointmentTime = String(appointmentTime).trim();
        }
        if (['Pending', 'Clinic-Pending'].includes(appointment.status)) {
            appointment.status = 'Confirmed';
        }

        await appointment.save();

        // Generate OPD Token if missing OR if doctor changed
        if (appointment.bookingType === 'Appointment') {
            await assignOpdTokenToAppointment(appointment, {
                forceRegenerate: isSwitchingDoctor
            });
        }

        try {
            const patientName = appointment.patients?.[0]?.patientName || "Patient";
            await sendPushNotification(
                doctor._id,
                'doctor',
                "New Appointment Assigned",
                `Clinic assigned ${appointment.bookingType} (#${appointment.bookingId}${appointment.formattedToken ? ` • Token #${appointment.formattedToken}` : ''}) for ${patientName} to you.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
                    formattedToken: String(appointment.formattedToken || ""),
                    type: "CLINIC_APPOINTMENT_ASSIGNED"
                }
            );
        } catch (notifErr) {
            console.error("Doctor Push Notification Error:", notifErr.message);
        }

        const populatedAppointment = await Appointment.findById(appointment._id)
            .populate('doctorId', 'name speciality qualification profileImage phone dutyStatus')
            .populate('clinicId', 'name clinicName city address')
            .populate('userId', 'name phone email')
            .lean();

        return res.status(200).json({
            success: true,
            message: `Appointment #${appointment.bookingId} successfully assigned to ${doctor.name}.`,
            data: populatedAppointment
        });

    } catch (error) {
        console.error("Assign Appointment To Clinic Doctor Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// ==========================================
// 10. CLINIC REASSIGNS APPOINTMENT TO ANOTHER FREE CLINIC DOCTOR (Regenerates New Doctor's OPD Token)
// ==========================================
const reassignAppointmentToClinicDoctor = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            appointmentId,
            newDoctorId,
            doctorId,
            reason,
            notes,
            appointmentDate,
            appointmentTime
        } = req.body || {};

        const targetDoctorId = newDoctorId || doctorId;
        const reassignReason = (reason || notes || "").trim();

        if (!appointmentId || !targetDoctorId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId and newDoctorId (or doctorId) are required."
            });
        }

        if (!mongoose.Types.ObjectId.isValid(targetDoctorId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid newDoctorId format."
            });
        }

        const apptQuery = mongoose.Types.ObjectId.isValid(appointmentId)
            ? { $or: [{ _id: appointmentId }, { bookingId: appointmentId }], clinicId }
            : { bookingId: appointmentId, clinicId };

        const appointment = await Appointment.findOne(apptQuery);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or does not belong to your clinic."
            });
        }

        const blockedStatuses = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'];
        if (blockedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot reassign doctor because appointment status is '${appointment.status}'.`
            });
        }

        if (!appointment.doctorId) {
            return res.status(400).json({
                success: false,
                message: "No doctor is currently assigned to this appointment. Please use the Assign Appointment API instead."
            });
        }

        const previousDoctorId = appointment.doctorId.toString();

        if (previousDoctorId === String(targetDoctorId)) {
            return res.status(400).json({
                success: false,
                message: "Appointment is already assigned to this doctor. Please select a different doctor to reassign."
            });
        }

        const newDoctor = await Doctor.findOne({ _id: targetDoctorId, clinicId });
        if (!newDoctor) {
            return res.status(404).json({
                success: false,
                message: "Target doctor not found in your clinic."
            });
        }

        if (newDoctor.isActive === false) {
            return res.status(400).json({
                success: false,
                message: `${newDoctor.name} account is currently inactive.`
            });
        }

        if (newDoctor.profileStatus !== 'Approved') {
            return res.status(400).json({
                success: false,
                message: `${newDoctor.name} profile is '${newDoctor.profileStatus}'. Only Approved doctors can be assigned.`
            });
        }

        if (['Busy', 'Off Duty', 'On Leave'].includes(newDoctor.dutyStatus)) {
            return res.status(400).json({
                success: false,
                message: `${newDoctor.name} is currently '${newDoctor.dutyStatus}' and not free for reassignment.`
            });
        }

        const previousDoctor = await Doctor.findById(previousDoctorId).select('name speciality').lean();
        const prevDocName = previousDoctor?.name || "Previous Doctor";
        const now = new Date();

        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
            if (!appointment.treatmentHistory[i].endTime) {
                appointment.treatmentHistory[i].endTime = now;
                appointment.treatmentHistory[i].acceptanceStatus = appointment.treatmentHistory[i].acceptanceStatus === 'Pending-Acceptance'
                    ? 'Unaccepted-Reassigned'
                    : 'Replaced-After-Acceptance';
                if (appointment.treatmentHistory[i].startTime) {
                    const diffMins = Math.max(0, Math.floor((now - new Date(appointment.treatmentHistory[i].startTime)) / 60000));
                    const hrs = Math.floor(diffMins / 60);
                    const mins = diffMins % 60;
                    appointment.treatmentHistory[i].durationDisplay = hrs > 0
                        ? `${hrs} hr ${mins} mins (Reassigned)`
                        : `${mins} mins (Reassigned)`;
                } else {
                    appointment.treatmentHistory[i].durationDisplay = "Reassigned";
                }
                break;
            }
        }

        const logNote = reassignReason
            ? `Reassigned from ${prevDocName} to ${newDoctor.name} by Clinic. Reason: ${reassignReason}`
            : `Reassigned from ${prevDocName} to ${newDoctor.name} by Clinic.`;

        appointment.treatmentHistory.push({
            fromDoctorId: previousDoctorId,
            toDoctorId: newDoctor._id,
            action: 'Transfer-Accepted',
            acceptanceStatus: 'Pending-Acceptance',
            assignedAt: now,
            notes: logNote,
            startTime: now
        });

        appointment.doctorId = newDoctor._id;
        appointment.pendingDoctorId = null;
        appointment.doctorAcceptanceStatus = 'Pending';
        appointment.doctorRejectionReason = "";
        appointment.doctorRespondedAt = null;

        if (appointmentDate) {
            appointment.appointmentDate = new Date(appointmentDate);
        }
        if (appointmentTime) {
            appointment.appointmentTime = String(appointmentTime).trim();
        }
        if (['Pending', 'Clinic-Pending'].includes(appointment.status)) {
            appointment.status = 'Confirmed';
        }

        await appointment.save();

        // Generate fresh OPD token under the new doctor's queue
        if (appointment.bookingType === 'Appointment') {
            await assignOpdTokenToAppointment(appointment, { forceRegenerate: true });
        }

        const patientName = appointment.patients?.[0]?.patientName || "Patient";
        Promise.allSettled([
            sendPushNotification(
                newDoctor._id,
                'doctor',
                "Appointment Reassigned to You",
                `Clinic reassigned ${appointment.bookingType} (#${appointment.bookingId}${appointment.formattedToken ? ` • Token #${appointment.formattedToken}` : ''}) for ${patientName} to you.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
                    formattedToken: String(appointment.formattedToken || ""),
                    type: "CLINIC_APPOINTMENT_REASSIGNED"
                }
            ),
            sendPushNotification(
                previousDoctorId,
                'doctor',
                "Appointment Reassigned",
                `Appointment #${appointment.bookingId} (${patientName}) has been reassigned to ${newDoctor.name}.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
                    type: "CLINIC_APPOINTMENT_MOVED"
                }
            ),
            appointment.userId
                ? sendPushNotification(
                    appointment.userId,
                    'user',
                    "Doctor Updated for Your Appointment",
                    `Your appointment #${appointment.bookingId} has been reassigned to ${newDoctor.name}${appointment.formattedToken ? ` (New Token #${appointment.formattedToken})` : ''}.`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
                        formattedToken: String(appointment.formattedToken || ""),
                        type: "APPOINTMENT_DOCTOR_REASSIGNED"
                    }
                )
                : Promise.resolve()
        ]).catch((err) => console.error("Reassign Notification Error:", err.message));

        const populatedAppointment = await Appointment.findById(appointment._id)
            .populate('doctorId', 'name speciality qualification profileImage phone dutyStatus')
            .populate('clinicId', 'name clinicName city address')
            .populate('userId', 'name phone email')
            .lean();

        return res.status(200).json({
            success: true,
            message: `Appointment #${appointment.bookingId} successfully reassigned from ${prevDocName} to ${newDoctor.name}.`,
            reassignmentSummary: {
                previousDoctor: {
                    _id: previousDoctorId,
                    name: prevDocName
                },
                newDoctor: {
                    _id: newDoctor._id,
                    name: newDoctor.name,
                    speciality: newDoctor.speciality
                },
                reason: reassignReason || "Reassigned by Clinic",
                reassignedAt: now
            },
            data: populatedAppointment
        });

    } catch (error) {
        console.error("Reassign Appointment To Clinic Doctor Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// ==========================================
// 9. GET FREE / ON-DUTY CLINIC DOCTORS (Prioritizes User-Selected Doctor First)
// @route   GET /api/clinic/doctors/available?appointmentId=...&search=...&speciality=...
// @access  Private (Clinic)
// ==========================================
const getAvailableClinicDoctors = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { appointmentId, selectedDoctorId, search, speciality } = req.query;

        let targetSelectedDoctorId = null;
        let isDoctorSelectedAlready = false;
        let selectedDoctorWarning = null;

        // 1. Check if Appointment has a user-selected doctor
        if (appointmentId && String(appointmentId).trim() !== '') {
            const cleanApptId = String(appointmentId).trim();
            const apptQuery = mongoose.Types.ObjectId.isValid(cleanApptId)
                ? { $or: [{ _id: cleanApptId }, { bookingId: cleanApptId }], clinicId }
                : { bookingId: cleanApptId, clinicId };

            const appointment = await Appointment.findOne(apptQuery)
                .select('doctorId isDoctorSelectedAlready treatmentHistory')
                .lean();

            if (!appointment) {
                return res.status(404).json({
                    success: false,
                    message: "Appointment not found in your clinic."
                });
            }

            const hasClinicAssigned = Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0;

            if (
                appointment.doctorId &&
                (
                    appointment.isDoctorSelectedAlready === true ||
                    (appointment.isDoctorSelectedAlready === undefined && !hasClinicAssigned)
                )
            ) {
                targetSelectedDoctorId = appointment.doctorId.toString();
                isDoctorSelectedAlready = true;
            }
        } else if (selectedDoctorId && mongoose.Types.ObjectId.isValid(selectedDoctorId)) {
            targetSelectedDoctorId = String(selectedDoctorId);
            isDoctorSelectedAlready = true;
        }

        // 2. Build Free Doctors Filter (Exclude Busy, Off Duty, On Leave)
        const doctorQuery = {
            clinicId,
            isActive: true,
            profileStatus: 'Approved',
            dutyStatus: { $nin: ['Busy', 'Off Duty', 'On Leave'] }
        };

        if (speciality && String(speciality).trim() !== '') {
            doctorQuery.speciality = new RegExp(String(speciality).trim(), 'i');
        }

        if (search && String(search).trim() !== '') {
            const regex = new RegExp(String(search).trim(), 'i');
            doctorQuery.$or = [
                { name: regex },
                { speciality: regex },
                { qualification: regex }
            ];
        }

        // 3. Fetch Free Clinic Doctors
        const freeDoctors = await Doctor.find(doctorQuery)
            .select('_id name profileImage speciality qualification experienceYears gender dutyStatus fees consultationStatus isClinicAvailable isOnlineAvailable isHomeAvailable averageRating totalReviews department')
            .sort({ averageRating: -1, createdAt: -1 })
            .lean();

        // 4. Check if User-Selected Doctor is currently Busy / Off Duty / On Leave
        if (isDoctorSelectedAlready && targetSelectedDoctorId) {
            const isSelectedDoctorInFreeList = freeDoctors.some(
                (doc) => doc._id.toString() === targetSelectedDoctorId
            );

            if (!isSelectedDoctorInFreeList) {
                const selectedDocRecord = await Doctor.findOne({ _id: targetSelectedDoctorId, clinicId })
                    .select('name dutyStatus isActive profileStatus')
                    .lean();

                if (selectedDocRecord) {
                    selectedDoctorWarning = `User selected ${selectedDocRecord.name}, who is currently '${selectedDocRecord.dutyStatus || 'Unavailable'}'. Please select another free doctor.`;
                }
            }
        }

        // 5. Attach `isDoctorSelectedAlready` per doctor & Sort selected doctor FIRST
        const formattedDoctors = freeDoctors.map((doc) => {
            const isThisSelected = Boolean(
                isDoctorSelectedAlready &&
                targetSelectedDoctorId &&
                doc._id.toString() === targetSelectedDoctorId
            );

            return {
                ...doc,
                isDoctorSelectedAlready: isThisSelected
            };
        });

        formattedDoctors.sort((a, b) => {
            if (a.isDoctorSelectedAlready === b.isDoctorSelectedAlready) return 0;
            return a.isDoctorSelectedAlready ? -1 : 1; // Selected doctor always at index 0
        });

        return res.status(200).json({
            success: true,
            isDoctorSelectedAlready,
            selectedDoctorId: targetSelectedDoctorId,
            selectedDoctorWarning,
            count: formattedDoctors.length,
            data: formattedDoctors
        });

    } catch (error) {
        console.error("Get Available Clinic Doctors Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};



////////////////// SLOTs ADD and LEAVE APPROVE ////////////

// ==========================================
// Helper: Normalize Time String to 24H ("HH:mm") & Day Roster Maps
// ==========================================
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_SHORT_TO_FULL = {
    mon: 'Monday', monday: 'Monday',
    tue: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday', thursday: 'Thursday',
    fri: 'Friday', friday: 'Friday',
    sat: 'Saturday', saturday: 'Saturday',
    sun: 'Sunday', sunday: 'Sunday'
};
const DAY_FULL_TO_SHORT = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
    Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
};

const normalizeTime24 = (timeStr, fallback = "09:00") => {
    if (!timeStr) return fallback;
    const clean = String(timeStr).trim();
    if (/^\d{1,2}:\d{2}$/.test(clean)) {
        const [h, m] = clean.split(':').map(Number);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const parsed = moment(clean, ["hh:mm A", "h:mm A", "HH:mm", "H:mm", "hh:mma", "h:mma"]);
    return parsed.isValid() ? parsed.format("HH:mm") : fallback;
};
// ==========================================
// Helper: Generate Date-wise Live OPD Slot Grid for a Clinic Doctor
// ==========================================
const buildDoctorLiveSlotsForDate = async (doctor, availConfig, targetDateStr) => {
    const cleanDate = moment(targetDateStr || new Date()).format("YYYY-MM-DD");
    const targetMoment = moment(cleanDate, "YYYY-MM-DD");
    const dayFull = targetMoment.format("dddd");
    const dayShort = targetMoment.format("ddd");

    const offDaysNormalized = (availConfig?.offDays || []).map(
        (d) => DAY_SHORT_TO_FULL[String(d).trim().toLowerCase()] || d
    );
    const blockedDates = availConfig?.blockedDates || [];

    const isApprovedLeaveDate = (doctor.leaves || []).some((l) => {
        if (l.status !== 'Approved') return false;
        const lStart = moment(l.startDate).format("YYYY-MM-DD");
        const lEnd = moment(l.endDate).format("YYYY-MM-DD");
        return cleanDate >= lStart && cleanDate <= lEnd;
    });

    const isOpdActive = doctor.isClinicAvailable !== false && doctor.consultationStatus?.clinic !== false;
    const isOffDay = offDaysNormalized.includes(dayFull);
    const isBlockedDate = blockedDates.includes(cleanDate) || isApprovedLeaveDate;

    if (!isOpdActive) {
        return { date: cleanDate, day: dayFull, isClosed: true, reason: "OPD is currently disabled for this doctor.", slots: [] };
    }
    if (isBlockedDate) {
        return { date: cleanDate, day: dayFull, isClosed: true, reason: `Doctor is on Leave / Unavailable on ${cleanDate}.`, slots: [] };
    }
    if (isOffDay) {
        return { date: cleanDate, day: dayFull, isClosed: true, reason: `${dayFull} is marked as Weekly Off.`, slots: [] };
    }

    const startTime24 = normalizeTime24(availConfig?.startTime, "09:00");
    const endTime24 = normalizeTime24(availConfig?.endTime, "17:00");
    const duration = Math.max(5, Number(availConfig?.slotDuration || doctor.slotDuration || 30));

    const rawSlots = generateTimeSlots({
        startTime: startTime24,
        endTime: endTime24,
        slotDuration: duration,
        morningSlots: availConfig?.morningSlots !== false,
        afternoonSlots: availConfig?.afternoonSlots !== false,
        eveningSlots: availConfig?.eveningSlots !== false,
        unavailableSlots: [],
        premiumSlots: availConfig?.premiumSlots || []
    });

    const dayStart = targetMoment.clone().startOf('day').toDate();
    const dayEnd = targetMoment.clone().endOf('day').toDate();

    const bookedAppts = await Appointment.find({
        doctorId: doctor._id,
        bookingType: { $in: ['Appointment', 'Emergency'] },
        status: { $in: ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Completed'] },
        appointmentDate: { $gte: dayStart, $lte: dayEnd }
    }).select('appointmentTime bookingId status patients').lean();

    const bookedMap = {};
    bookedAppts.forEach((b) => {
        const t24 = normalizeTime24(b.appointmentTime, "");
        if (t24) bookedMap[t24] = b;
    });

    const unavailableSet = new Set(
        (availConfig?.unavailableSlots || []).map((t) => normalizeTime24(t, t))
    );

    const dateBlockedMap = {};
    (availConfig?.blockedSlotsWithReason || []).forEach((b) => {
        if (b.date === cleanDate) {
            dateBlockedMap[normalizeTime24(b.time, b.time)] = b.reason || "Blocked by Clinic";
        }
    });

    const nowIST = moment().utcOffset("+05:30");
    const isToday = cleanDate === nowIST.format("YYYY-MM-DD");

    const finalSlots = rawSlots.map((s) => {
        const t24 = s.slotTime;
        const formatted12 = moment(t24, "HH:mm").format("hh:mm A");
        const slotMomentIST = moment.utc(`${cleanDate} ${t24}`, "YYYY-MM-DD HH:mm").utcOffset("+05:30");
        const isPast = isToday && slotMomentIST.isBefore(nowIST);

        const bookedInfo = bookedMap[t24] || null;
        const dateBlockReason = dateBlockedMap[t24] || null;
        const isRecurringBlocked = unavailableSet.has(t24);

        let status = "Available";
        if (dateBlockReason || isRecurringBlocked) status = "Blocked";
        else if (bookedInfo) status = "Booked";
        else if (isPast) status = "Past";

        return {
            time: formatted12,
            time24: t24,
            displayTime: s.displayTime,
            category: s.category,
            status,
            isAvailable: status === "Available",
            isPremium: s.isPremium,
            extraFee: s.extraFee,
            blockReason: dateBlockReason || (isRecurringBlocked ? "Blocked recurring slot" : null),
            bookedDetails: bookedInfo ? {
                appointmentId: bookedInfo._id,
                bookingId: bookedInfo.bookingId,
                patientName: bookedInfo.patients?.[0]?.patientName || "Patient",
                status: bookedInfo.status
            } : null
        };
    });

    return {
        date: cleanDate,
        day: dayFull,
        dayShort,
        isClosed: false,
        totalSlots: finalSlots.length,
        availableCount: finalSlots.filter((x) => x.isAvailable).length,
        bookedCount: finalSlots.filter((x) => x.status === 'Booked').length,
        blockedCount: finalSlots.filter((x) => x.status === 'Blocked').length,
        slots: finalSlots
    };
};



// ==========================================
// 8. CLINIC SETS DOCTOR'S OPD CABIN, WEEKLY ROSTER, SLOTS & SYNCS AVAILABILITY (Without OPD Fee)
// @route   PUT /api/clinic/doctors/configure-opd/:doctorId
// @access  Private (Clinic)
// ==========================================
const configureDoctorOpdScheduleByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { doctorId } = req.params;
        const {
            cabinNumber,
            roomNumber,
            slotDuration,
            availability,
            availableDays,
            isOpdEnabled,
            isClinicAvailable,
            premiumSlots,
            unavailableSlots,
            startTime,
            endTime,
            offDays,
            morningSlots,
            afternoonSlots,
            eveningSlots
        } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid doctorId format." });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, clinicId }).lean();
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found in this clinic."
            });
        }

        const safeParse = (val, defaultVal = {}) => {
            if (val === undefined || val === null) return defaultVal;
            if (typeof val === 'object') return val;
            if (typeof val === 'string') {
                try { return JSON.parse(val); } catch (e) { return defaultVal; }
            }
            return defaultVal;
        };

        // 1. OPD Enable / Disable Flag
        let currentConsultation = safeParse(doctor.consultationStatus, { online: true, clinic: true, home: false });
        let isClinicAvail = doctor.isClinicAvailable !== undefined ? doctor.isClinicAvailable : true;
        const opdToggleInput = isOpdEnabled !== undefined ? isOpdEnabled : isClinicAvailable;

        if (opdToggleInput !== undefined) {
            const enabledBool = (opdToggleInput === true || opdToggleInput === 'true');
            currentConsultation.clinic = enabledBool;
            isClinicAvail = enabledBool;
        }

        // 2. Cabin / Room Number
        const resolvedCabin = cabinNumber !== undefined
            ? String(cabinNumber).trim()
            : (roomNumber !== undefined
                ? String(roomNumber).trim()
                : (doctor.cabinNumber || doctor.department?.roomNumber || "Cabin 1"));

        let currentDepartment = safeParse(doctor.department, { isNormal: true, isEmergency: false, roomNumber: resolvedCabin });
        currentDepartment.roomNumber = resolvedCabin;

        // 3. Slot Duration & Shift Hours
        const existingAvail = await Availability.findOne({ vendorId: doctorId }).lean();

        const resolvedSlotDuration = slotDuration !== undefined
            ? Math.max(5, parseInt(slotDuration, 10) || 30)
            : (doctor.slotDuration || existingAvail?.slotDuration || 30);

        const resolvedStartTime = startTime
            ? normalizeTime24(startTime, "09:00")
            : (existingAvail?.startTime || "09:00");

        const resolvedEndTime = endTime
            ? normalizeTime24(endTime, "17:00")
            : (existingAvail?.endTime || "17:00");

        if (resolvedStartTime >= resolvedEndTime) {
            return res.status(400).json({
                success: false,
                message: "Shift startTime must be earlier than endTime."
            });
        }

        // 4. Weekly Roster: Resolve availableDays <-> offDays <-> doctor.availability
        let resolvedOffDays = existingAvail?.offDays || [];
        let parsedAvailabilityArray = doctor.availability || [];

        if (availableDays !== undefined) {
            const parsedActive = Array.isArray(availableDays)
                ? availableDays
                : safeParse(availableDays, []);
            const activeFullSet = new Set(
                parsedActive.map((d) => DAY_SHORT_TO_FULL[String(d).trim().toLowerCase()]).filter(Boolean)
            );
            resolvedOffDays = FULL_DAYS.filter((fullDay) => !activeFullSet.has(fullDay));
            parsedAvailabilityArray = FULL_DAYS
                .filter((fullDay) => activeFullSet.has(fullDay))
                .map((fullDay) => ({
                    day: DAY_FULL_TO_SHORT[fullDay],
                    startTime: resolvedStartTime,
                    endTime: resolvedEndTime,
                    isLiveTrackingAvailable: false
                }));
        } else if (offDays !== undefined) {
            const parsedOff = Array.isArray(offDays) ? offDays : safeParse(offDays, []);
            const offFullSet = new Set(
                parsedOff.map((d) => DAY_SHORT_TO_FULL[String(d).trim().toLowerCase()]).filter(Boolean)
            );
            resolvedOffDays = Array.from(offFullSet);
            parsedAvailabilityArray = FULL_DAYS
                .filter((fullDay) => !offFullSet.has(fullDay))
                .map((fullDay) => ({
                    day: DAY_FULL_TO_SHORT[fullDay],
                    startTime: resolvedStartTime,
                    endTime: resolvedEndTime,
                    isLiveTrackingAvailable: false
                }));
        } else if (availability !== undefined) {
            parsedAvailabilityArray = Array.isArray(availability)
                ? availability
                : safeParse(availability, []);
            if (parsedAvailabilityArray.length > 0) {
                const activeFullSet = new Set(
                    parsedAvailabilityArray.map((a) => DAY_SHORT_TO_FULL[String(a.day).trim().toLowerCase()]).filter(Boolean)
                );
                resolvedOffDays = FULL_DAYS.filter((fullDay) => !activeFullSet.has(fullDay));
            }
        }

        // 5. Update Doctor Document (Without modifying fees)
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            {
                $set: {
                    cabinNumber: resolvedCabin,
                    department: currentDepartment,
                    consultationStatus: currentConsultation,
                    isClinicAvailable: isClinicAvail,
                    slotDuration: resolvedSlotDuration,
                    availability: parsedAvailabilityArray
                }
            },
            { new: true }
        )
            .select('name speciality profileImage cabinNumber department slotDuration availability consultationStatus isClinicAvailable dutyStatus leaves')
            .lean();

        if (resolvedCabin) {
            await Clinic.findByIdAndUpdate(clinicId, {
                $addToSet: { cabins: resolvedCabin }
            });
        }

        // 6. Sync Availability Collection
        const availabilitySyncFields = {
            vendorId: new mongoose.Types.ObjectId(doctorId),
            vendorType: 'Doctor',
            clinicId: new mongoose.Types.ObjectId(clinicId),
            slotDuration: resolvedSlotDuration,
            startTime: resolvedStartTime,
            endTime: resolvedEndTime,
            offDays: resolvedOffDays,
            morningSlots: morningSlots !== undefined ? (morningSlots === true || morningSlots === 'true') : true,
            afternoonSlots: afternoonSlots !== undefined ? (afternoonSlots === true || afternoonSlots === 'true') : true,
            eveningSlots: eveningSlots !== undefined ? (eveningSlots === true || eveningSlots === 'true') : true
        };

        if (premiumSlots !== undefined) {
            availabilitySyncFields.premiumSlots = Array.isArray(premiumSlots)
                ? premiumSlots
                : safeParse(premiumSlots, []);
        }

        if (unavailableSlots !== undefined) {
            const rawUnavail = Array.isArray(unavailableSlots)
                ? unavailableSlots
                : safeParse(unavailableSlots, []);
            availabilitySyncFields.unavailableSlots = rawUnavail.map((t) => normalizeTime24(t, t));
        }

        const syncedAvail = await Availability.findOneAndUpdate(
            { vendorId: doctorId },
            { $set: availabilitySyncFields },
            { upsert: true, new: true }
        ).lean();

        // 7. Generate Today's Live Slots Preview
        const liveSlotsPreview = await buildDoctorLiveSlotsForDate(
            updatedDoctor,
            syncedAvail,
            moment().format("YYYY-MM-DD")
        );

        return res.status(200).json({
            success: true,
            message: `OPD Configuration, Cabin & Slots synced for ${updatedDoctor.name}.`,
            data: {
                doctor: updatedDoctor,
                opdConfig: {
                    isOpdEnabled: isClinicAvail,
                    cabinNumber: resolvedCabin,
                    slotDuration: resolvedSlotDuration,
                    startTime: resolvedStartTime,
                    endTime: resolvedEndTime,
                    startTime12h: moment(resolvedStartTime, "HH:mm").format("hh:mm A"),
                    endTime12h: moment(resolvedEndTime, "HH:mm").format("hh:mm A"),
                    offDays: resolvedOffDays,
                    activeDays: FULL_DAYS.filter((d) => !resolvedOffDays.includes(d))
                },
                availabilityConfig: syncedAvail,
                liveSlotsPreview
            }
        });

    } catch (error) {
        console.error("Configure Doctor OPD Schedule By Clinic Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 11. CLINIC GETS DOCTOR OPD SETTINGS, CABIN, WEEKLY ROSTER, LIVE SLOTS & LEAVES (Without OPD Fee)
// @route   GET /api/clinic/doctors/opd-settings/:doctorId?date=YYYY-MM-DD
// @access  Private (Clinic)
// ==========================================
const getDoctorOpdSettingsByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { doctorId } = req.params;
        const { date } = req.query;

        if (!mongoose.Types.ObjectId.isValid(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid doctorId format." });
        }

        const [doctor, clinic, availConfig] = await Promise.all([
            Doctor.findOne({ _id: doctorId, clinicId })
                .select('name speciality qualification profileImage cabinNumber department slotDuration availability consultationStatus isClinicAvailable dutyStatus leaves')
                .lean(),
            Clinic.findById(clinicId).select('name clinicName cabins totalCabins').lean(),
            Availability.findOne({ vendorId: doctorId }).lean()
        ]);

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found in this clinic."
            });
        }

        const startTime24 = normalizeTime24(availConfig?.startTime, "09:00");
        const endTime24 = normalizeTime24(availConfig?.endTime, "17:00");
        const offDays = (availConfig?.offDays || []).map(
            (d) => DAY_SHORT_TO_FULL[String(d).trim().toLowerCase()] || d
        );
        const activeDays = FULL_DAYS.filter((d) => !offDays.includes(d));

        const targetDateStr = date && String(date).trim() !== ''
            ? moment(date).format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD");

        const liveSlots = await buildDoctorLiveSlotsForDate(doctor, availConfig, targetDateStr);

        const leavesSorted = (doctor.leaves || [])
            .map((l) => ({
                ...l,
                startDateFormatted: moment(l.startDate).format("YYYY-MM-DD"),
                endDateFormatted: moment(l.endDate).format("YYYY-MM-DD")
            }))
            .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

        return res.status(200).json({
            success: true,
            data: {
                doctor: {
                    _id: doctor._id,
                    name: doctor.name,
                    speciality: doctor.speciality,
                    qualification: doctor.qualification,
                    profileImage: doctor.profileImage,
                    dutyStatus: doctor.dutyStatus || "On Duty",
                    cabinNumber: doctor.cabinNumber || doctor.department?.roomNumber || "",
                    isOpdEnabled: doctor.isClinicAvailable !== false && doctor.consultationStatus?.clinic !== false,
                    slotDuration: Number(availConfig?.slotDuration || doctor.slotDuration || 30)
                },
                clinicCabins: clinic?.cabins || [],
                shiftHours: {
                    startTime: startTime24,
                    endTime: endTime24,
                    startTime12h: moment(startTime24, "HH:mm").format("hh:mm A"),
                    endTime12h: moment(endTime24, "HH:mm").format("hh:mm A")
                },
                weeklyRoster: {
                    activeDaysCount: activeDays.length,
                    offDaysCount: offDays.length,
                    activeDays,
                    offDays,
                    daysList: FULL_DAYS.map((dayName) => ({
                        day: dayName,
                        shortDay: DAY_FULL_TO_SHORT[dayName],
                        isActive: !offDays.includes(dayName)
                    }))
                },
                premiumSlots: availConfig?.premiumSlots || [],
                unavailableSlots: availConfig?.unavailableSlots || [],
                blockedDates: availConfig?.blockedDates || [],
                blockedSlotsWithReason: availConfig?.blockedSlotsWithReason || [],
                liveSlots,
                leaveRequests: {
                    totalCount: leavesSorted.length,
                    pendingCount: leavesSorted.filter((l) => l.status === 'Pending').length,
                    list: leavesSorted
                }
            }
        });
    } catch (error) {
        console.error("Get Doctor OPD Settings By Clinic Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 12. CLINIC BLOCKS OR UNBLOCKS A SPECIFIC TIME SLOT FOR DOCTOR
// @route   POST /api/clinic/doctors/opd-slots/toggle-block/:doctorId
// @access  Private (Clinic)
// ==========================================
const toggleDoctorOpdSlotBlockByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { doctorId } = req.params;
        const { timeSlot, time, action, date, reason } = req.body || {};

        const rawTime = timeSlot || time;
        if (!mongoose.Types.ObjectId.isValid(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid doctorId format." });
        }
        if (!rawTime || !action || !['block', 'unblock'].includes(String(action).toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: "timeSlot (e.g. '10:30 AM' or '10:30') and action ('block' or 'unblock') are required."
            });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, clinicId }).select('_id name').lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in this clinic." });
        }

        const cleanAction = String(action).toLowerCase();
        const time24 = normalizeTime24(rawTime, String(rawTime).trim());

        // CASE A: Date-specific block/unblock
        if (date && String(date).trim() !== '') {
            const cleanDate = moment(date).format("YYYY-MM-DD");
            if (!moment(cleanDate, "YYYY-MM-DD", true).isValid()) {
                return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
            }

            const avail = await Availability.findOneAndUpdate(
                { vendorId: doctorId },
                {
                    $set: { vendorType: 'Doctor', clinicId },
                    $pull: { blockedSlotsWithReason: { date: cleanDate, time: time24 } }
                },
                { upsert: true, new: true }
            );

            if (cleanAction === 'block') {
                avail.blockedSlotsWithReason.push({
                    date: cleanDate,
                    time: time24,
                    reason: reason ? String(reason).trim() : "Blocked by Clinic Admin",
                    blockedAt: new Date()
                });
                await avail.save();
            }

            return res.status(200).json({
                success: true,
                message: `Slot ${moment(time24, "HH:mm").format("hh:mm A")} on ${cleanDate} ${cleanAction === 'block' ? 'blocked' : 'unblocked'} for ${doctor.name}.`,
                blockedSlotsWithReason: avail.blockedSlotsWithReason
            });
        }

        // CASE B: Recurring daily slot block/unblock
        const updateOp = cleanAction === 'block'
            ? { $set: { vendorType: 'Doctor', clinicId }, $addToSet: { unavailableSlots: time24 } }
            : { $pull: { unavailableSlots: time24 } };

        const config = await Availability.findOneAndUpdate(
            { vendorId: doctorId },
            updateOp,
            { upsert: true, new: true }
        ).lean();

        return res.status(200).json({
            success: true,
            message: `Recurring slot ${moment(time24, "HH:mm").format("hh:mm A")} ${cleanAction === 'block' ? 'blocked' : 'unblocked'} for ${doctor.name}.`,
            unavailableSlots: config.unavailableSlots || []
        });
    } catch (error) {
        console.error("Toggle Doctor OPD Slot Block Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 13. CLINIC GETS DOCTOR LEAVE APPLICATIONS (All Doctors or Specific Doctor)
// @route   GET /api/clinic/doctors/leaves
// @route   GET /api/clinic/doctors/leaves/:doctorId
// @access  Private (Clinic)
// ==========================================
const getClinicDoctorLeaves = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const targetDoctorId = req.params.doctorId || req.query.doctorId || null;
        const { status } = req.query; // Optional: 'Pending' | 'Approved' | 'Rejected'

        const doctorFilter = { clinicId };
        if (targetDoctorId) {
            if (!mongoose.Types.ObjectId.isValid(targetDoctorId)) {
                return res.status(400).json({ success: false, message: "Invalid doctorId format." });
            }
            doctorFilter._id = targetDoctorId;
        }

        const doctors = await Doctor.find(doctorFilter)
            .select('_id name speciality qualification profileImage cabinNumber leaves')
            .lean();

        let allLeaveRequests = [];
        doctors.forEach((doc) => {
            (doc.leaves || []).forEach((leave) => {
                if (status && String(leave.status).toLowerCase() !== String(status).trim().toLowerCase()) {
                    return;
                }
                const daysCount = Math.max(
                    1,
                    moment(leave.endDate).startOf('day').diff(moment(leave.startDate).startOf('day'), 'days') + 1
                );

                allLeaveRequests.push({
                    leaveId: leave._id,
                    doctorId: doc._id,
                    doctorName: doc.name,
                    speciality: doc.speciality,
                    profileImage: doc.profileImage,
                    cabinNumber: doc.cabinNumber || "",
                    startDate: moment(leave.startDate).format("YYYY-MM-DD"),
                    endDate: moment(leave.endDate).format("YYYY-MM-DD"),
                    totalDays: daysCount,
                    reason: leave.reason,
                    status: leave.status,
                    rejectionReason: leave.rejectionReason || "",
                    appliedAt: leave.appliedAt,
                    reviewedAt: leave.reviewedAt || null
                });
            });
        });

        allLeaveRequests.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

        return res.status(200).json({
            success: true,
            totalCount: allLeaveRequests.length,
            pendingCount: allLeaveRequests.filter((l) => l.status === 'Pending').length,
            approvedCount: allLeaveRequests.filter((l) => l.status === 'Approved').length,
            rejectedCount: allLeaveRequests.filter((l) => l.status === 'Rejected').length,
            data: allLeaveRequests
        });
    } catch (error) {
        console.error("Get Clinic Doctor Leaves Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 14. CLINIC APPROVES OR REJECTS DOCTOR LEAVE REQUEST
// (Approved leaves automatically block those dates in Availability.blockedDates)
// @route   PATCH /api/clinic/doctors/leaves/respond
// @access  Private (Clinic)
// ==========================================
const respondToDoctorLeaveByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { doctorId, leaveId, action, status, rejectionReason, reason } = req.body || {};

        if (!doctorId || !leaveId) {
            return res.status(400).json({
                success: false,
                message: "doctorId and leaveId are required."
            });
        }

        if (!mongoose.Types.ObjectId.isValid(doctorId) || !mongoose.Types.ObjectId.isValid(leaveId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid doctorId or leaveId format."
            });
        }

        const rawDecision = String(action || status || '').trim().toLowerCase();
        let finalStatus = null;
        if (['approve', 'approved'].includes(rawDecision)) finalStatus = 'Approved';
        else if (['reject', 'rejected'].includes(rawDecision)) finalStatus = 'Rejected';

        if (!finalStatus) {
            return res.status(400).json({
                success: false,
                message: "Valid action ('Approve' or 'Reject') or status ('Approved' or 'Rejected') is required."
            });
        }

        const cleanRejectReason = String(rejectionReason || reason || '').trim();
        if (finalStatus === 'Rejected' && !cleanRejectReason) {
            return res.status(400).json({
                success: false,
                message: "rejectionReason is required when rejecting a leave application."
            });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, clinicId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found in your clinic."
            });
        }

        const leaveItem = doctor.leaves.id(leaveId);
        if (!leaveItem) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found for this doctor."
            });
        }

        if (leaveItem.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: `This leave request has already been ${leaveItem.status}.`
            });
        }

        const now = new Date();
        leaveItem.status = finalStatus;
        leaveItem.reviewedAt = now;
        leaveItem.rejectionReason = finalStatus === 'Rejected' ? cleanRejectReason : "";

        // Collect all YYYY-MM-DD dates from startDate to endDate
        const leaveDatesList = [];
        let cursor = moment(leaveItem.startDate).startOf('day');
        const endCursor = moment(leaveItem.endDate).startOf('day');
        while (cursor.isSameOrBefore(endCursor)) {
            leaveDatesList.push(cursor.format("YYYY-MM-DD"));
            cursor.add(1, 'days');
        }

        // If leave covers today, update dutyStatus
        const todayStr = moment().format("YYYY-MM-DD");
        if (finalStatus === 'Approved' && leaveDatesList.includes(todayStr)) {
            doctor.dutyStatus = 'On Leave';
        }

        await doctor.save();

        // Automatically block all approved leave dates in Availability.blockedDates
        if (finalStatus === 'Approved' && leaveDatesList.length > 0) {
            await Availability.findOneAndUpdate(
                { vendorId: doctor._id },
                {
                    $set: { vendorType: 'Doctor', clinicId },
                    $addToSet: { blockedDates: { $each: leaveDatesList } }
                },
                { upsert: true, new: true }
            );
        }

        // Notify Doctor via FCM (Non-blocking)
        sendPushNotification(
            doctor._id,
            'doctor',
            `Leave Request ${finalStatus}`,
            finalStatus === 'Approved'
                ? `Your leave from ${moment(leaveItem.startDate).format("DD MMM")} to ${moment(leaveItem.endDate).format("DD MMM")} has been approved.`
                : `Your leave request was rejected. Reason: ${cleanRejectReason}`,
            {
                doctorId: String(doctor._id),
                leaveId: String(leaveItem._id),
                status: finalStatus,
                type: "CLINIC_DOCTOR_LEAVE_RESPONDED"
            }
        ).catch(() => {});

        return res.status(200).json({
            success: true,
            message: finalStatus === 'Approved'
                ? `Leave approved for ${doctor.name}. ${leaveDatesList.length} date(s) automatically blocked from patient bookings.`
                : `Leave rejected for ${doctor.name}.`,
            blockedDatesAdded: finalStatus === 'Approved' ? leaveDatesList : [],
            data: leaveItem
        });
    } catch (error) {
        console.error("Respond To Doctor Leave Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
}


module.exports = {
    addClinicDoctor,
    getMyClinicDoctors,
    updateClinicDoctor,
    toggleDoctorDutyStatus,
    removeClinicDoctor,
    loginClinicDoctor,
    assignAppointmentToClinicDoctor,
    reassignAppointmentToClinicDoctor,
    configureDoctorOpdScheduleByClinic,
    getAvailableClinicDoctors,
    getDoctorOpdSettingsByClinic,
    toggleDoctorOpdSlotBlockByClinic,
    getClinicDoctorLeaves,
    respondToDoctorLeaveByClinic,
    
};