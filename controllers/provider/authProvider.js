const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Food = require('../../models/Food'); // <-- Imported as 'Food' exactly as requested

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const sendEmailOTP = require('../../utils/emailService'); 
const { deleteFile } = require('../../utils/fileHandler');

// Helper: Token Generation (Lifetime for Dev, 30d for Prod)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// Helper: Category to Model Mapping
const getModelByCategory = (category) => {
    const map = { 
        'Lab': Lab, 
        'Pharmacy': Pharmacy,
        'Food': Food // <-- Food mapped
    };
    return map[category];
};

// Helper: Global Duplicate Check
const checkGlobalExists = async (query) => {
    const models = [Lab, Pharmacy, Food]; // Food Added
    for (let Model of models) {
        const exists = await Model.findOne(query);
        if (exists) return true;
    }
    return false;
};

// ==========================================
// 1. REGISTER PROVIDER
// ==========================================
const registerProvider = async (req, res) => {
    try {
        const { name, email, phone, password, category, country, state, city } = req.body;

        const Model = getModelByCategory(category);
        if (!Model) return res.status(400).json({ message: "Invalid category. Choose Lab, Pharmacy, or Food" });

        const isDuplicate = await checkGlobalExists({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (isDuplicate) return res.status(400).json({ message: 'Email or Phone already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newProvider = await Model.create({
            name, 
            email: email?.toLowerCase(), 
            phone,
            password: hashedPassword,
            category,
            role: category, 
            country, state, city,
            profileStatus: 'Incomplete'
        });

        const token = generateToken(newProvider._id, category);
        newProvider.token = token;
        await newProvider.save();

        res.status(201).json({ 
            success: true, 
            message: 'Registered successfully. Please login to upload documents.', 
            token,
            category,
            profileStatus: 'Incomplete' 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. LOGIN PROVIDER
// ==========================================
const loginProvider = async (req, res) => {
    try {
        const { email, phone, password, category } = req.body;
        
        const Model = getModelByCategory(category);
        if (!Model) return res.status(400).json({ message: "Specify category (Lab/Pharmacy/Food)" });

        let query = email ? { email: email.toLowerCase() } : { phone };
        const provider = await Model.findOne(query).select('+password');

        if (!provider || !(await bcrypt.compare(String(password), provider.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (provider.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: `Access Denied: Your ${category} partner account is inactive. Please contact support.` 
            });
        }

        if (provider.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.' 
            });
        }

        if (provider.profileStatus === 'Incomplete') {
            const token = provider.token || generateToken(provider._id, category);
            
            if (!provider.token) {
                await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
            }

            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload documents to proceed.' 
            });
        }

        if (provider.profileStatus === 'Rejected') {
            const token = provider.token || generateToken(provider._id, category);
            
            if (!provider.token) {
                await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
            }

            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Rejected',
                rejectionReason: provider.rejectionReason,
                message: `Application Rejected: ${provider.rejectionReason}. Please re-upload documents.` 
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && provider.token) {
            try {
                jwt.verify(provider.token, process.env.JWT_SECRET);
                token = provider.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(provider._id, category);
            await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
        }

        provider.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: provider 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 3. STATUS TOGGLE API
// ==========================================
const toggleProviderOnlineStatus = async (req, res) => {
    try {
        const { isOnline } = req.body;
        const providerId = req.user.id;
        const role = req.user.role; 

        if (isOnline === undefined) {
            return res.status(400).json({ success: false, message: "isOnline status value is required." });
        }

        const Model = getModelByCategory(role);
        if (!Model) return res.status(400).json({ success: false, message: "Invalid Provider Role" });

        const updatedProvider = await Model.findByIdAndUpdate(
            providerId,
            { $set: { isOnline: Boolean(isOnline) } },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: `Your status has been updated to ${isOnline ? 'Online' : 'Offline'}.`,
            isOnline: updatedProvider.isOnline
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. SEPARATE UPLOAD DOCS: LAB
// ==========================================
const uploadLabDocs = async (req, res) => {
    try {
        const labId = req.user.id;
        const { documentState, issuingAuthority, gstNumber, experience, drugLicenseType, about } = req.body;
        const files = req.files;

        const existingLab = await Lab.findById(labId);
        if (!existingLab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }

        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            experience,
            drugLicenseType,
            labImages: files?.labImages ? files.labImages.map(f => f.path) : [],
            labCertificates: files?.labCertificates ? files.labCertificates.map(f => f.path) : [],
            labLicenses: files?.labLicenses ? files.labLicenses.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            drugLicenses: files?.drugLicenses ? files.drugLicenses.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        if (files?.profileImage && existingLab.profileImage) {
            deleteFile(existingLab.profileImage);
        }

        if (existingLab.documents) {
            const documentFields = [
                'labImages', 'labCertificates', 'labLicenses', 
                'gstCertificates', 'drugLicenses', 'otherCertificates'
            ];

            documentFields.forEach(field => {
                const oldFileList = existingLab.documents[field];
                if (Array.isArray(oldFileList)) {
                    oldFileList.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }

        const updatedLab = await Lab.findByIdAndUpdate(
            labId, 
            { 
                $set: { 
                    about,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Documents uploaded.", data: updatedLab });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 5. SEPARATE UPLOAD DOCS: PHARMACY
// ==========================================
const uploadPharmacyDocs = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { documentState, issuingAuthority, gstNumber, drugLicenseType, about, isHomeDeliveryAvailable, is24x7 } = req.body;
        const files = req.files;

        const existingPharmacy = await Pharmacy.findById(pharmacyId);
        if (!existingPharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy not found." });
        }

        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            drugLicenseType,
            pharmacyImages: files?.pharmacyImages ? files.pharmacyImages.map(f => f.path) : [],
            pharmacyCertificates: files?.pharmacyCertificates ? files.pharmacyCertificates.map(f => f.path) : [],
            pharmacyLicenses: files?.pharmacyLicenses ? files.pharmacyLicenses.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            drugLicenses: files?.drugLicenses ? files.drugLicenses.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        if (files?.profileImage && existingPharmacy.profileImage) {
            deleteFile(existingPharmacy.profileImage);
        }

        if (existingPharmacy.documents) {
            const documentFields = [
                'pharmacyImages', 'pharmacyCertificates', 'pharmacyLicenses', 
                'gstCertificates', 'drugLicenses', 'otherCertificates'
            ];

            documentFields.forEach(field => {
                const oldFileList = existingPharmacy.documents[field];
                if (Array.isArray(oldFileList)) {
                    oldFileList.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }

        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
            pharmacyId, 
            { 
                $set: { 
                    about,
                    isHomeDeliveryAvailable,
                    is24x7,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Pharmacy documents submitted for review.", data: updatedPharmacy });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 6. SEPARATE UPLOAD DOCS: FOOD (Added Newly for Food Flow)
// ==========================================
const uploadFoodDocs = async (req, res) => {
    try {
        const foodId = req.user.id;
        const { 
            documentState, issuingAuthority, gstNumber, foodLicenseType, foodLicenseNumber, foodLicenseExpiry,
            about, businessType, dietaryPreference, cuisines, isDeliveryAvailable, isDineInAvailable,
            isTakeawayAvailable, isPureVeg, isHalalCertified, is24x7, deliveryRadiusKm, minOrderAmount,
            averageCostForTwo, packagingCharges 
        } = req.body;
        const files = req.files;

        const existingFood = await Food.findById(foodId);
        if (!existingFood) {
            return res.status(404).json({ success: false, message: "Food business partner not found." });
        }

        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            foodLicenseType,
            foodLicenseNumber,
            foodLicenseExpiry: foodLicenseExpiry ? new Date(foodLicenseExpiry) : null,
            outletImages: files?.outletImages ? files.outletImages.map(f => f.path) : [],
            foodSafetyCertificates: files?.foodSafetyCertificates ? files.foodSafetyCertificates.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        if (files?.profileImage && existingFood.profileImage) {
            deleteFile(existingFood.profileImage);
        }
        if (files?.bannerImage && existingFood.bannerImage) {
            deleteFile(existingFood.bannerImage);
        }

        if (existingFood.documents) {
            const documentFields = ['outletImages', 'foodSafetyCertificates', 'gstCertificates', 'otherCertificates'];
            documentFields.forEach(field => {
                const oldFileList = existingFood.documents[field];
                if (Array.isArray(oldFileList)) {
                    oldFileList.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }

        let parsedDietary = dietaryPreference;
        if (typeof dietaryPreference === 'string') {
            try { parsedDietary = JSON.parse(dietaryPreference); } catch(e) {}
        }
        let parsedCuisines = cuisines;
        if (typeof cuisines === 'string') {
            try { parsedCuisines = JSON.parse(cuisines); } catch(e) {}
        }

        const updatedFood = await Food.findByIdAndUpdate(
            foodId, 
            { 
                $set: { 
                    about,
                    businessType,
                    dietaryPreference: parsedDietary,
                    cuisines: parsedCuisines,
                    isDeliveryAvailable,
                    isDineInAvailable,
                    isTakeawayAvailable,
                    isPureVeg,
                    isHalalCertified,
                    is24x7,
                    deliveryRadiusKm,
                    minOrderAmount,
                    averageCostForTwo,
                    packagingCharges,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path }),
                    ...(files?.bannerImage && { bannerImage: files.bannerImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Food business documents submitted for review.", data: updatedFood });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Helper to find provider across any model by Email
const findProviderByEmail = async (email) => {
    const models = [Lab, Pharmacy, Food];
    for (let Model of models) {
        const provider = await Model.findOne({ email: email.toLowerCase() });
        if (provider) return { provider, Model };
    }
    return null;
};

// ==========================================
// FORGOT PASSWORD
// ==========================================
const forgotPasswordProvider = async (req, res) => {
    try {
        const { email } = req.body;
        const result = await findProviderByEmail(email);

        if (!result) return res.status(404).json({ message: 'Provider not found' });

        const { provider } = result;

        let otp = process.env.NODE_ENV === 'development' ? '1111' : Math.floor(100000 + Math.random() * 900000).toString();

        provider.resetPasswordOtp = otp;
        provider.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
        await provider.save();

        if (process.env.NODE_ENV === 'production') {
            await sendEmailOTP(email, otp);
        }

        res.json({ success: true, message: 'OTP sent to your registered email' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// RESET PASSWORD
// ==========================================
const resetPasswordProvider = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const result = await findProviderByEmail(email);

        if (!result) return res.status(404).json({ message: 'Provider not found' });
        const { provider } = result;

        if (provider.resetPasswordOtp !== otp || provider.resetPasswordExpires < Date.now()) {
            return res.status(400).json({ message: 'Invalid or Expired OTP' });
        }

        provider.password = await bcrypt.hash(newPassword, 10);
        provider.resetPasswordOtp = undefined;
        provider.resetPasswordExpires = undefined;
        await provider.save();

        res.json({ success: true, message: 'Password reset successful. Please login.' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 7. GET PROVIDER PROFILE
// ==========================================
const getProviderProfile = async (req, res) => {
    try {
        const { id, role } = req.user; 
        const Model = getModelByCategory(role); 

        if (!Model) return res.status(400).json({ message: "Invalid Provider Role" });

        const profile = await Model.findById(id);

        if (!profile) return res.status(404).json({ message: "Profile not found" });

        res.json({ 
            success: true, 
            data: profile 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    registerProvider, 
    loginProvider, toggleProviderOnlineStatus,
    uploadLabDocs, 
    uploadPharmacyDocs, 
    uploadFoodDocs, // <-- Exported
    forgotPasswordProvider, 
    resetPasswordProvider, 
    getProviderProfile 
};