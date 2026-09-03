// controllers/clinic/authClinic.js

const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler'); // 👈 Disk cleanup helper

// Helper: Generate Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. REGISTER CLINIC ---
const registerClinic = async (req, res) => {
    try {
        const {
            name,
            clinicName,
            email,
            phoneNumber,
            country,
            state,
            city,
            password
        } = req.body;

        if (!email && !phoneNumber) {
            return res.status(400).json({ success: false, message: 'Email or Phone Number is required' });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }

        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phoneNumber) query.push({ phoneNumber });

        const exists = await Clinic.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Clinic already exists' });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);

        const newClinic = await Clinic.create({
            name,
            clinicName,
            email: email ? email.toLowerCase() : "",
            phoneNumber,
            country,
            state,
            city,
            password: hashedPassword,
            profileStatus: 'Incomplete',
            Accountverify: 'Incomplete'
        });

        const token = generateToken(newClinic._id, 'clinic');
        newClinic.token = token;
        await newClinic.save();

        res.status(201).json({
            success: true,
            message: 'Registered successfully. Please upload documents.',
            token,
            profileStatus: 'Incomplete',
            Accountverify: 'Incomplete'
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. LOGIN CLINIC ---
const loginClinic = async (req, res) => {
    try {
        const { email, phoneNumber, password } = req.body;
        
        let query = {};
        if (email) {
            query = { email: email.toLowerCase() };
        } else if (phoneNumber) {
            query = { phoneNumber };
        } else {
            return res.status(400).json({ success: false, message: "Email or Phone Number is required." });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: "Password is required." });
        }

        const clinic = await Clinic.findOne(query).select('+password');
        if (!clinic || !(await bcrypt.compare(String(password), clinic.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        if (clinic.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your clinic account is inactive. Please contact administrator." 
            });
        }

        let resolvedStatus = 'Incomplete';
        if (clinic.profileStatus === 'Approved' || clinic.Accountverify === 'Approved') {
            resolvedStatus = 'Approved';
        } else if (clinic.profileStatus === 'Rejected' || clinic.Accountverify === 'Rejected') {
            resolvedStatus = 'Rejected';
        } else if (clinic.profileStatus === 'Pending' || clinic.Accountverify === 'Pending') {
            resolvedStatus = 'Pending';
        }

        if (resolvedStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                Accountverify: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.' 
            });
        }

        if (resolvedStatus === 'Incomplete') {
            const token = clinic.token || generateToken(clinic._id, 'clinic');
            if (!clinic.token) { clinic.token = token; await clinic.save(); }

            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Incomplete',
                Accountverify: 'Incomplete',
                message: 'Profile incomplete. Please upload documents to proceed.' 
            });
        }

        if (resolvedStatus === 'Rejected') {
            const token = clinic.token || generateToken(clinic._id, 'clinic');
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Rejected',
                Accountverify: 'Rejected',
                rejectionReason: clinic.rejectionReason || clinic.rejectReason || "No specific reason provided.",
                message: `Application Rejected: ${clinic.rejectionReason || clinic.rejectReason}. Please re-upload documents.` 
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && clinic.token) {
            try {
                jwt.verify(clinic.token, process.env.JWT_SECRET);
                token = clinic.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(clinic._id, 'clinic');
            clinic.token = token;
            await clinic.save();
        }

        clinic.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved',
            Accountverify: 'Approved',
            data: clinic 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. TOGGLE CLINIC ONLINE STATUS ---
const toggleClinicOnlineStatus = async (req, res) => {
    try {
        const { isActive } = req.body;
        const clinicId = req.user.id;

        if (isActive === undefined) {
            return res.status(400).json({ success: false, message: "isActive status value is required." });
        }

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { $set: { isActive: Boolean(isActive) } },
            { new: true }
        ).select('-password');

        if (!updatedClinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        res.json({
            success: true,
            message: `Clinic status successfully updated to ${isActive ? 'Active' : 'Inactive'}.`,
            isActive: updatedClinic.isActive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. UPDATE CLINIC PROFILE & ADMIN REQUEST DISPATCHER (WITH FULL DISK CLEANUP) ---
const updateClinicProfile = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const updates = { ...req.body };
        const files = req.files;

        // Security parameters exclusion
        delete updates.email;
        delete updates.phoneNumber;
        delete updates.password;
        delete updates.role;
        delete updates.token;
        delete updates.fcmToken;
        delete updates.rejectionReason;
        delete updates.rejectReason;

        const existingClinic = await Clinic.findById(clinicId);
        if (!existingClinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        // 🗑️ FILE PROCESSING & DISK CLEANUP (Calling deleteFile on old assets)
        if (files) {
            // 1. Single Image Uploads
            if (files.image && files.image.length > 0) {
                if (existingClinic.image) deleteFile(existingClinic.image);
                updates.image = `/uploads/clinics/${files.image[0].filename}`;
            }
            if (files.posterimage && files.posterimage.length > 0) {
                if (existingClinic.posterimage) deleteFile(existingClinic.posterimage);
                updates.posterimage = `/uploads/clinics/${files.posterimage[0].filename}`;
            }
            if (files.certificateImage && files.certificateImage.length > 0) {
                if (existingClinic.certificateImage) deleteFile(existingClinic.certificateImage);
                updates.certificateImage = `/uploads/clinics/${files.certificateImage[0].filename}`;
            }
            if (files.licenceCertificate && files.licenceCertificate.length > 0) {
                if (existingClinic.licenceCertificate) deleteFile(existingClinic.licenceCertificate);
                updates.licenceCertificate = `/uploads/clinics/${files.licenceCertificate[0].filename}`;
            }

            // 2. Multiple Array Uploads
            if (files.clinicImages && files.clinicImages.length > 0) {
                if (existingClinic.clinicImages && existingClinic.clinicImages.length > 0) {
                    existingClinic.clinicImages.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
                updates.clinicImages = files.clinicImages.map(f => `/uploads/clinics/${f.filename}`);
            }

            if (files.achievementImages && files.achievementImages.length > 0) {
                if (existingClinic.achievementImages && existingClinic.achievementImages.length > 0) {
                    existingClinic.achievementImages.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
                updates.achievementImages = files.achievementImages.map(f => `/uploads/clinics/${f.filename}`);
            }

            if (files.licenseDocument && files.licenseDocument.length > 0) {
                if (existingClinic.licenseDocument && existingClinic.licenseDocument.length > 0) {
                    existingClinic.licenseDocument.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
                updates.licenseDocument = files.licenseDocument.map(f => `/uploads/clinics/${f.filename}`);
            }

            if (files.otherDocuments && files.otherDocuments.length > 0) {
                if (existingClinic.otherDocuments && existingClinic.otherDocuments.length > 0) {
                    existingClinic.otherDocuments.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
                updates.otherDocuments = files.otherDocuments.map(f => `/uploads/clinics/${f.filename}`);
            }

            // Text sync
            if (req.body.licenseNumber) updates.licenseNumber = req.body.licenseNumber;
            if (req.body.councilName) updates.councilName = req.body.councilName;
            if (req.body.councilNumber) updates.councilNumber = req.body.councilNumber;
        }

        // Parse JSON strings if sent from FormData
        if (typeof updates.bankDetails === 'string') {
            try { updates.bankDetails = JSON.parse(updates.bankDetails); } catch (e) {}
        }
        if (typeof updates.location === 'string') {
            try { updates.location = JSON.parse(updates.location); } catch (e) {}
        }

        const isApproved = existingClinic.profileStatus === 'Approved' || existingClinic.Accountverify === 'Approved';

        // 🚨 CASE 1: ALREADY APPROVED CLINIC -> Send Request to Admin via ProfileUpdateRequest
        if (isApproved) {
            let request = await ProfileUpdateRequest.findOne({
                vendorId: clinicId,
                vendorModel: 'Clinic',
                status: 'Pending'
            });

            if (request) {
                request.updatedFields = { ...request.updatedFields, ...updates };
                request.rejectionReason = "";
                await request.save();
            } else {
                request = await ProfileUpdateRequest.create({
                    vendorId: clinicId,
                    vendorModel: 'Clinic',
                    updatedFields: updates,
                    status: 'Pending'
                });
            }

            return res.json({
                success: true,
                message: "Profile update request submitted to Admin for approval.",
                hasPendingRequest: true,
                requestDetails: request
            });
        }

        // 🚨 CASE 2: FIRST-TIME ONBOARDING (Incomplete / Rejected State) -> Direct Save & Set Pending
        if (files) {
            updates.Accountverify = 'Pending';
            updates.profileStatus = 'Pending';
            updates.rejectReason = "";
            updates.rejectionReason = null;
        }

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { $set: updates },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: "Profile updated and submitted for Admin verification.",
            profileStatus: updatedClinic.profileStatus,
            Accountverify: updatedClinic.Accountverify,
            data: updatedClinic
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. GET LATEST PROFILE UPDATE REQUEST STATUS ---
const getLatestClinicProfileRequest = async (req, res) => {
    try {
        const clinicId = req.user.id;

        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: clinicId,
            vendorModel: 'Clinic'
        }).sort({ createdAt: -1 });

        res.json({
            success: true,
            hasPendingRequest: latestRequest?.status === 'Pending',
            data: latestRequest || null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. GET MY CLINIC PROFILE ---
const getMyClinicProfile = async (req, res) => {
    try {
        const clinic = await Clinic.findById(req.user.id).select(
            '-password -bankDetails -startDay -endDay -MorningStartTime -eveningStartTime -MorningEndTime -eveningEndTime -holiday'
        );
        
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        res.json({
            success: true,
            data: clinic
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 7. CHANGE CLINIC PASSWORD ---
const changeClinicPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Both old and new passwords are required." });
        }

        const clinic = await Clinic.findById(req.user.id).select('+password');
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        const isMatch = await bcrypt.compare(String(oldPassword), clinic.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Incorrect old password." });
        }

        clinic.password = await bcrypt.hash(String(newPassword), 10);
        await clinic.save();

        res.json({
            success: true,
            message: "Password changed successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    registerClinic, 
    loginClinic, 
    toggleClinicOnlineStatus, 
    updateClinicProfile, 
    getLatestClinicProfileRequest,
    getMyClinicProfile,
    changeClinicPassword 
};