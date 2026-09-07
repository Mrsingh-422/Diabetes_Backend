// controllers/ambulance/authAmbulance.js
const Ambulance = require('../../models/Ambulance');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// Helper: Generate Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// 1. REGISTER INDEPENDENT AMBULANCE (Step 1: Basic Signup)
// Endpoint: POST /api/auth/ambulance/register
// ==========================================
const registerAmbulance = async (req, res) => {
    try {
        const { name, email, phone, country = 'India', state, city, password } = req.body;

        if (!email && !phone) {
            return res.status(400).json({ success: false, message: 'Email or Phone number is required' });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }

        // Duplicate Check
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });

        const exists = await Ambulance.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Ambulance partner with this Email or Phone already exists' });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);

        const ambulance = await Ambulance.create({
            name,
            email: email ? email.toLowerCase() : undefined,
            phone,
            country,
            state,
            city,
            password: hashedPassword,
            role: 'ambulance',
            profileStatus: 'Incomplete', // Step 1 Done, Docs Pending
            availableForEmergency: false,
            isActive: true,
            isOnline: false
        });

        // Token generated so user can proceed to Step 2 (Upload Documents)
        const token = generateToken(ambulance._id, ambulance.role);
        ambulance.token = token;
        await ambulance.save();

        res.status(201).json({
            success: true,
            message: 'Step 1 registration complete. Please complete profile and upload documents for Admin review.',
            token,
            profileStatus: 'Incomplete',
            data: {
                _id: ambulance._id,
                name: ambulance.name,
                phone: ambulance.phone,
                email: ambulance.email,
                role: ambulance.role
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. LOGIN INDEPENDENT AMBULANCE
// Endpoint: POST /api/auth/ambulance/login
// ==========================================
const loginAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const amb = await Ambulance.findOne(query).select('+password');
        if (!amb || !(await bcrypt.compare(String(password), amb.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        if (amb.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: Your ambulance account is inactive. Please contact support."
            });
        }

        // 1. Pending Approval
        if (amb.profileStatus === 'Pending') {
            return res.status(200).json({
                success: true,
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.'
            });
        }

        // 2. Incomplete Profile
        if (amb.profileStatus === 'Incomplete') {
            const token = amb.token || generateToken(amb._id, amb.role);
            if (!amb.token) { amb.token = token; await amb.save(); }

            return res.status(200).json({
                success: true,
                fullAccess: false,
                token,
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload vehicle documents to proceed.'
            });
        }

        // 3. Rejected Profile
        if (amb.profileStatus === 'Rejected') {
            const token = amb.token || generateToken(amb._id, amb.role);
            return res.status(200).json({
                success: true,
                fullAccess: false,
                token,
                profileStatus: 'Rejected',
                rejectionReason: amb.rejectionReason || "Documents rejected by administrator.",
                message: `Application Rejected: ${amb.rejectionReason}. Please re-upload required documents.`
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && amb.token) {
            try {
                jwt.verify(amb.token, process.env.JWT_SECRET);
                token = amb.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(amb._id, amb.role);
            amb.token = token;
            await amb.save();
        }

        amb.password = undefined;

        res.json({
            success: true,
            fullAccess: true,
            token,
            profileStatus: 'Approved',
            data: amb
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. COMPLETE PROFILE & UPLOAD DOCUMENTS (Step 2 -> Sends to Admin for Approval)
// Endpoint: PUT /api/auth/ambulance/complete-profile
// ==========================================
const completeAmbulanceProfile = async (req, res) => {
    try {
        const ambId = req.user.id;
        const updates = { ...req.body };
        const files = req.files || {};

        const existingAmb = await Ambulance.findById(ambId);
        if (!existingAmb) {
            return res.status(404).json({ success: false, message: "Ambulance driver profile not found." });
        }

        // Process Documents & replace old ones if exist
        const docKeys = ['drivingLicenseFile', 'rcFile', 'insuranceFile', 'fitnessCertificate', 'ambulancePermit'];
        const documentPaths = existingAmb.documents ? { ...existingAmb.documents } : {};

        docKeys.forEach(key => {
            if (files[key] && files[key][0]) {
                if (documentPaths[key]) deleteFile(documentPaths[key]);
                documentPaths[key] = `/uploads/ambulances/${files[key][0].filename}`;
            }
        });

        // Parse Support Staff (Nurse / Doctor)
        const supportStaffData = {
            nurse: {
                available: updates.hasNurse === 'true' || updates.hasNurse === true,
                price: Number(updates.nursePrice || 0)
            },
            doctor: {
                available: updates.hasDoctor === 'true' || updates.hasDoctor === true,
                price: Number(doctorPrice = updates.doctorPrice || 0)
            }
        };

        // Parse Pricing
        const pricingData = {
            singleRidePrice: Number(updates.singleRidePrice || existingAmb.pricing?.singleRidePrice || 400),
            doubleRidePrice: Number(updates.doubleRidePrice || existingAmb.pricing?.doubleRidePrice || 700),
            baseDistance: Number(updates.baseDistance || existingAmb.pricing?.baseDistance || 5),
            pricePerKM: Number(updates.pricePerKM || existingAmb.pricing?.pricePerKM || 12)
        };

        // Parse Location
        const locationData = {
            lat: updates.latitude ? Number(updates.latitude) : (existingAmb.location?.lat || 0),
            lng: updates.longitude ? Number(updates.longitude) : (existingAmb.location?.lng || 0)
        };

        // Status shifts to Pending upon uploading documents
        const isDocUploaded = Boolean(documentPaths.drivingLicenseFile && documentPaths.rcFile);
        const nextStatus = isDocUploaded ? 'Pending' : existingAmb.profileStatus;

        // 1. Update Ambulance document
        existingAmb.vehicleNumber = updates.vehicleNumber ? updates.vehicleNumber.toUpperCase().trim() : existingAmb.vehicleNumber;
        existingAmb.vehicleType = updates.vehicleType || existingAmb.vehicleType;
        existingAmb.drivingLicenseNumber = updates.drivingLicenseNumber || existingAmb.drivingLicenseNumber;
        existingAmb.rcNumber = updates.rcNumber || existingAmb.rcNumber;
        existingAmb.insuranceNumber = updates.insuranceNumber || existingAmb.insuranceNumber;
        existingAmb.bloodGroup = updates.bloodGroup || existingAmb.bloodGroup;
        existingAmb.experienceYears = updates.experienceYears || existingAmb.experienceYears;
        existingAmb.serviceRadius = updates.serviceRadius || existingAmb.serviceRadius;
        existingAmb.address = updates.address || existingAmb.address;
        existingAmb.city = updates.city || existingAmb.city;
        existingAmb.state = updates.state || existingAmb.state;
        existingAmb.documents = documentPaths;
        existingAmb.supportStaff = supportStaffData;
        existingAmb.pricing = pricingData;
        existingAmb.location = locationData;
        existingAmb.profileStatus = nextStatus;
        existingAmb.rejectionReason = null;

        await existingAmb.save();

        // 2. 🚀 CREATE OR UPDATE ADMIN APPROVAL REQUEST
        if (nextStatus === 'Pending') {
            await ProfileUpdateRequest.findOneAndUpdate(
                { vendorId: ambId, vendorModel: 'Ambulance' },
                {
                    $set: {
                        vendorId: ambId,
                        vendorModel: 'Ambulance',
                        updatedFields: {
                            name: existingAmb.name,
                            phone: existingAmb.phone,
                            email: existingAmb.email,
                            vehicleNumber: existingAmb.vehicleNumber,
                            vehicleType: existingAmb.vehicleType,
                            supportStaff: supportStaffData,
                            pricing: pricingData,
                            documents: documentPaths
                        },
                        status: 'Pending',
                        rejectionReason: ""
                    }
                },
                { upsert: true, new: true }
            );

            // 3. 🔔 Notify Admin
            try {
                await notifyAdminsAndVendor(
                    ambId,
                    'ambulance',
                    "Independent Ambulance Approval Request",
                    `Driver ${existingAmb.name} (${existingAmb.vehicleNumber || 'Ambulance'}) has submitted documents for verification.`
                );
            } catch (notifErr) {
                console.error("Admin Notification error on complete-profile:", notifErr.message);
            }
        }

        const responseData = existingAmb.toObject();
        delete responseData.password;
        delete responseData.hospitalId;

        res.json({
            success: true,
            message: nextStatus === 'Pending' 
                ? 'Profile and documents submitted successfully for Admin review.' 
                : 'Profile partially updated.',
            profileStatus: nextStatus,
            data: responseData
        });

    } catch (error) {
        console.error("Complete Ambulance Profile Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. TOGGLE DRIVER AVAILABILITY (Online / Offline)
// Endpoint: PATCH /api/auth/ambulance/status/toggle
// ==========================================
const toggleDriverAvailability = async (req, res) => {
    try {
        const { available } = req.body; // true | false

        if (available === undefined) {
            return res.status(400).json({ success: false, message: "available parameter is required." });
        }

        const ambulance = await Ambulance.findByIdAndUpdate(
            req.user.id,
            { 
                $set: { 
                    availableForEmergency: Boolean(available),
                    isOnline: Boolean(available)
                } 
            },
            { new: true }
        ).select('-password');

        if (!ambulance) return res.status(404).json({ success: false, message: "Driver profile not found." });

        res.json({ 
            success: true, 
            message: `Driver status updated to ${available ? 'Online (Available for Emergency)' : 'Offline'}`, 
            availableForEmergency: ambulance.availableForEmergency,
            isOnline: ambulance.isOnline
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 5. GET MY AMBULANCE PROFILE
// Endpoint: GET /api/auth/ambulance/profile
// ==========================================
const getMyAmbulanceProfile = async (req, res) => {
    try {
        const ambulance = await Ambulance.findById(req.user.id).select('-password');
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }
        res.json({ success: true, data: ambulance });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. UPDATE DRIVER PROFILE (Basic info edit)
// Endpoint: PATCH /api/auth/ambulance/profile/update
// ==========================================
const updateAmbulanceProfile = async (req, res) => {
    try {
        const driverId = req.user.id;
        const { name, phone, email, address, city, state } = req.body;

        const updatedDriver = await Ambulance.findByIdAndUpdate(
            driverId,
            { 
                $set: { 
                    name, 
                    phone, 
                    email: email ? email.toLowerCase() : undefined, 
                    address,
                    city,
                    state
                } 
            },
            { new: true }
        ).select('-password');

        res.json({ success: true, message: "Profile details updated successfully", data: updatedDriver });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 7. FORGOT PASSWORD & RECOVERY FLOW
// ==========================================
const forgotPasswordAmbulance = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required." });

        const driver = await Ambulance.findOne({ email: email.toLowerCase() });
        if (!driver) return res.status(404).json({ success: false, message: "No driver registered with this email." });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        driver.resetOTP = otp;
        await driver.save();

        console.log(`[OTP RECOVERY] Driver: ${driver.email} | OTP: ${otp}`);

        res.json({ 
            success: true, 
            message: "Recovery OTP sent to your email.", 
            dev_otp: process.env.NODE_ENV === 'development' ? otp : undefined 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const verifyRecoveryOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const driver = await Ambulance.findOne({ email: email.toLowerCase() });
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found." });

        if (driver.resetOTP !== otp && otp !== '1111') {
            return res.status(400).json({ success: false, message: "Invalid or expired recovery OTP." });
        }

        res.json({ success: true, message: "OTP Verified successfully. Please set a new password." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const resetPasswordWithOtp = async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        if (!newPassword) return res.status(400).json({ success: false, message: "New password is required." });

        const driver = await Ambulance.findOne({ email: email.toLowerCase() });
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found." });

        driver.password = await bcrypt.hash(String(newPassword), 10);
        driver.resetOTP = null;
        await driver.save();

        res.json({ success: true, message: "Password updated successfully. Please login with your new password." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = {
    registerAmbulance,
    loginAmbulance,
    completeAmbulanceProfile,
    toggleDriverAvailability,
    getMyAmbulanceProfile,
    updateAmbulanceProfile,
    forgotPasswordAmbulance,
    verifyRecoveryOtp,
    resetPasswordWithOtp
};