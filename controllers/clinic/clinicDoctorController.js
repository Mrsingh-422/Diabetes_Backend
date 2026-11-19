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
// 7. CLINIC ASSIGNS APPOINTMENT TO CLINIC DOCTOR
// @route   PUT /api/clinic/doctors/assign-appointment
// @access  Private (Clinic)
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

        if (previousDoctorId && previousDoctorId !== doctor._id.toString()) {
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
        } else if (previousDoctorId !== doctor._id.toString()) {
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
        appointment.doctorAcceptanceStatus = 'Pending'; // 👈 Reset for new doctor response
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

        try {
            const patientName = appointment.patients?.[0]?.patientName || "Patient";
            await sendPushNotification(
                doctor._id,
                'doctor',
                "New Appointment Assigned",
                `Clinic assigned ${appointment.bookingType} (#${appointment.bookingId}) for ${patientName} to you.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
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
// 10. CLINIC REASSIGNS APPOINTMENT TO ANOTHER FREE CLINIC DOCTOR
// @route   PUT /api/clinic/doctors/reassign-appointment
// @access  Private (Clinic)
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
        appointment.doctorAcceptanceStatus = 'Pending'; // 👈 Reset for new doctor response
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

        const patientName = appointment.patients?.[0]?.patientName || "Patient";
        Promise.allSettled([
            sendPushNotification(
                newDoctor._id,
                'doctor',
                "Appointment Reassigned to You",
                `Clinic reassigned ${appointment.bookingType} (#${appointment.bookingId}) for ${patientName} to you.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
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
                    `Your appointment #${appointment.bookingId} has been reassigned to ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}).`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
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
// 8. CLINIC SETS DOCTOR'S OPD CABIN, FEE, SCHEDULE & SYNCS AVAILABILITY
// @route   PUT /api/clinic/doctors/configure-opd/:doctorId
// @access  Private (Clinic)
// ==========================================
const configureDoctorOpdScheduleByClinic = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { doctorId } = req.params;
        const {
            roomNumber,
            slotDuration,
            opdFee,
            availability,
            isOpdEnabled,
            premiumSlots,
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

        const safeObjectParse = (val, defaultVal = {}) => {
            if (!val) return defaultVal;
            if (typeof val === 'object' && val !== null) return val;
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (typeof parsed === 'object' && parsed !== null) return parsed;
                } catch (e) {}
            }
            return defaultVal;
        };

        let currentConsultation = safeObjectParse(doctor.consultationStatus, { online: true, clinic: true, home: false });
        let isClinicAvail = doctor.isClinicAvailable !== undefined ? doctor.isClinicAvailable : true;

        if (isOpdEnabled !== undefined) {
            const enabledBool = (isOpdEnabled === true || isOpdEnabled === 'true');
            currentConsultation.clinic = enabledBool;
            isClinicAvail = enabledBool;
        }

        let currentFees = safeObjectParse(doctor.fees, { online: 0, clinic: 500, home: 0 });
        if (opdFee !== undefined) {
            currentFees.clinic = Math.max(0, parseInt(opdFee, 10) || 0);
        }

        let currentDepartment = safeObjectParse(doctor.department, { isNormal: true, isEmergency: false, roomNumber: "Cabin 1" });
        if (roomNumber !== undefined) {
            currentDepartment.roomNumber = String(roomNumber).trim();
        }

        const resolvedSlotDuration = slotDuration !== undefined
            ? Math.max(5, parseInt(slotDuration, 10) || 15)
            : (doctor.slotDuration || 30);

        const updatePayload = {
            consultationStatus: currentConsultation,
            isClinicAvailable: isClinicAvail,
            fees: currentFees,
            department: currentDepartment,
            slotDuration: resolvedSlotDuration
        };

        let parsedAvailabilityArray = doctor.availability || [];
        if (availability !== undefined) {
            parsedAvailabilityArray = Array.isArray(availability)
                ? availability
                : (typeof availability === 'string' ? safeObjectParse(availability, []) : []);
            updatePayload.availability = parsedAvailabilityArray;
        }

        // 1. Update Doctor Document
        await Doctor.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(doctorId) },
            { $set: updatePayload }
        );

        // 2. Sync Slot Duration, Start/End Times & Premium Slots in Availability Collection
        const availabilitySyncFields = {
            vendorId: new mongoose.Types.ObjectId(doctorId),
            vendorType: 'Doctor',
            clinicId: new mongoose.Types.ObjectId(clinicId),
            slotDuration: resolvedSlotDuration
        };

        if (startTime) {
            availabilitySyncFields.startTime = String(startTime).trim();
        } else if (parsedAvailabilityArray.length > 0 && parsedAvailabilityArray[0].startTime) {
            availabilitySyncFields.startTime = parsedAvailabilityArray[0].startTime;
        }

        if (endTime) {
            availabilitySyncFields.endTime = String(endTime).trim();
        } else if (parsedAvailabilityArray.length > 0 && parsedAvailabilityArray[0].endTime) {
            availabilitySyncFields.endTime = parsedAvailabilityArray[0].endTime;
        }

        if (offDays !== undefined) {
            availabilitySyncFields.offDays = Array.isArray(offDays) ? offDays : safeObjectParse(offDays, []);
        }

        if (premiumSlots !== undefined) {
            availabilitySyncFields.premiumSlots = Array.isArray(premiumSlots) ? premiumSlots : safeObjectParse(premiumSlots, []);
        }

        if (morningSlots !== undefined) {
            availabilitySyncFields.morningSlots = (morningSlots === true || morningSlots === 'true');
        }
        if (afternoonSlots !== undefined) {
            availabilitySyncFields.afternoonSlots = (afternoonSlots === true || afternoonSlots === 'true');
        }
        if (eveningSlots !== undefined) {
            availabilitySyncFields.eveningSlots = (eveningSlots === true || eveningSlots === 'true');
        }

        await Availability.findOneAndUpdate(
            { vendorId: doctorId },
            { $set: availabilitySyncFields },
            { upsert: true, new: true }
        );

        const updatedDoctor = await Doctor.findById(doctorId)
            .select('name speciality fees department slotDuration availability consultationStatus isClinicAvailable')
            .lean();

        return res.status(200).json({
            success: true,
            message: `OPD Configuration and Slots synced for ${updatedDoctor.name}.`,
            data: updatedDoctor
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
    getAvailableClinicDoctors
};