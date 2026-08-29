const Food = require('../../../models/Food');
const bcrypt = require('bcryptjs');
const { deleteFile } = require('../../../utils/fileHandler'); // File cleanup utility
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update staging requests

// 1. GET FOOD PROFILE
// Endpoint: GET /provider/food/profile
const getFoodProfile = async (req, res) => {
    try {
        const foodVendor = await Food.findById(req.user.id);
        if (!foodVendor) {
            return res.status(404).json({ success: false, message: "Food vendor not found." });
        }
        res.json({ success: true, data: foodVendor });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. UPDATE FOOD PROFILE (Staged via ProfileUpdateRequest)
// Endpoint: PUT /provider/food/profile/update
const updateFoodProfile = async (req, res) => {
    try {
        const foodId = req.user.id;
        const {
            name, about, address,
            country, state, city, lat, lng,
            alternatePhone,
            cuisineSpecialities, fssaiNumber,
            documentState, issuingAuthority, gstNumber, drugLicenseType
        } = req.body;
 
        const existingFood = await Food.findById(foodId);
        if (!existingFood) {
            return res.status(404).json({ success: false, message: "Food vendor not found." });
        }

        let updateData = {
            name, 
            about, 
            address, 
            country, 
            state, 
            city,
            location: { 
                lat: Number(lat || existingFood.location?.lat || 0), 
                lng: Number(lng || existingFood.location?.lng || 0) 
            },
            alternatePhone
        };
 
        // Parse cuisineSpecialities if passed as string/JSON
        if (cuisineSpecialities) {
            updateData.cuisineSpecialities = typeof cuisineSpecialities === 'string'
                ? JSON.parse(cuisineSpecialities)
                : cuisineSpecialities;
        }

        // 🚨 Robust Path Cleaner (Removes 'public', fixes double backslashes to single forward slashes)
        const cleanPath = (filePath) => {
            if (!filePath) return '';
            let normalized = filePath.replace(/\\/g, '/');
            normalized = normalized.replace(/^public\//, '').replace(/^\/+/, '');
            return `/${normalized}`;
        };
 
        // 1. Handle Profile Image Upload via Multer
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updateData.profileImage = cleanPath(req.files.profileImage[0].path);
        }

        // 2. Handle Documents Text Details
        if (fssaiNumber !== undefined) updateData['documents.fssaiNumber'] = fssaiNumber;
        if (gstNumber !== undefined) updateData['documents.gstNumber'] = gstNumber;
        if (documentState !== undefined) updateData['documents.documentState'] = documentState;
        if (issuingAuthority !== undefined) updateData['documents.issuingAuthority'] = issuingAuthority;
        if (drugLicenseType !== undefined) updateData['documents.drugLicenseType'] = drugLicenseType;

        // 3. Handle Documents Array / File Uploads with clean paths
        if (req.files) {
            if (req.files.kitchenImages && req.files.kitchenImages.length > 0) {
                updateData['documents.kitchenImages'] = req.files.kitchenImages.map(f => cleanPath(f.path));
            }
            if (req.files.fssaiCertificates && req.files.fssaiCertificates.length > 0) {
                updateData['documents.fssaiCertificates'] = req.files.fssaiCertificates.map(f => cleanPath(f.path));
            }
            if (req.files.gstCertificates && req.files.gstCertificates.length > 0) {
                updateData['documents.gstCertificates'] = req.files.gstCertificates.map(f => cleanPath(f.path));
            }
            if (req.files.otherCertificates && req.files.otherCertificates.length > 0) {
                updateData['documents.otherCertificates'] = req.files.otherCertificates.map(f => cleanPath(f.path));
            }
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: foodId, vendorModel: 'Food', status: 'Pending' });
        if (existingPending) {
            if (updateData.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            // Optional cleanup for document arrays if needed
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }
 
        // Create Staged Update Request for Admin Approval
        const request = await ProfileUpdateRequest.create({
            vendorId: foodId,
            vendorModel: 'Food',
            updatedFields: updateData,
            status: 'Pending'
        });
       
        res.json({ 
            success: true, 
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.", 
            data: request 
        });
    } catch (error) {
        console.error("Food Profile Update Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET LATEST PROFILE UPDATE REQUEST STATUS
// Endpoint: GET /provider/food/profile/update-status
const getLatestFoodProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Food'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. CHANGE FOOD VENDOR PASSWORD
// Endpoint: PATCH /provider/food/profile/change-password
const changeFoodPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        const foodVendor = await Food.findById(req.user.id).select('+password');
        if (!foodVendor) {
            return res.status(404).json({ success: false, message: "Food vendor not found." });
        }

        const isMatch = await bcrypt.compare(String(oldPassword), foodVendor.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        foodVendor.password = await bcrypt.hash(String(newPassword), 10);
        await foodVendor.save();

        res.json({ success: true, message: "Food vendor password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getFoodProfile, 
    updateFoodProfile, 
    getLatestFoodProfileRequest, 
    changeFoodPassword 
};