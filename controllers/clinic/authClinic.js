const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler'); // 👈 Imported from your first project's helper

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

        // 🚨 Dynamic Status Resolver: Resolves true status by combining both legacy and new status keys safely
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

// --- 4. UPDATE CLINIC PROFILE & DOCUMENTS ---
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
        delete updates.profileStatus;
        delete updates.Accountverify;
        delete updates.rejectionReason;
        delete updates.rejectReason;

        const existingClinic = await Clinic.findById(clinicId);
        if (!existingClinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        // Processing files upload
        if (files) {
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

            // Sync text details
            if (req.body.licenseNumber) updates.licenseNumber = req.body.licenseNumber;
            if (req.body.councilName) updates.councilName = req.body.councilName;
            if (req.body.councilNumber) updates.councilNumber = req.body.councilNumber;

            // 🚨 Keep both old and new status variables fully synchronized on document upload
            updates.Accountverify = 'Pending'; 
            updates.profileStatus = 'Pending';
            updates.rejectReason = ""; 
            updates.rejectionReason = null;
        }

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { $set: updates },
            { new: true }
        );

        res.json({
            success: true,
            message: "Profile updated successfully.",
            data: updatedClinic
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Endpoint: GET /api/auth/clinic/profile
const getMyClinicProfile = async (req, res) => {
    try {
        // password, bankDetails aur saare operational timing hours fields ko filter karke query kiya hai
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

// --- 6. CHANGE CLINIC PASSWORD ---
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
    getMyClinicProfile,
    changeClinicPassword 
};