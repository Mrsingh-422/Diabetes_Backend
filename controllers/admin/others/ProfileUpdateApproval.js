// controllers/admin/others/ProfileUpdateApproval.js
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const { deleteFile } = require('../../../utils/fileHandler');

// Models mapping for dynamic resolution
const Doctor = require('../../../models/Doctor');
const Food = require('../../../models/Food');
const Pharmacy = require('../../../models/Pharmacy');
const Lab = require('../../../models/Lab');
const Driver = require('../../../models/Driver');
const Clinic = require('../../../models/Clinic');       //  Added Clinic
const Ambulance = require('../../../models/Ambulance'); //  Added Ambulance

const modelMap = {
    'Doctor': Doctor,
    'Pharmacy': Pharmacy,
    'Lab': Lab,
    'Food': Food, 
    'Driver': Driver,
    'Clinic': Clinic,       //  Mapped Clinic
    'Ambulance': Ambulance  //  Mapped Ambulance
};

// 1. GET: List Profile Update Requests (With Pagination & Filters)
// Endpoint: GET /api/admin/profile-update
const getProfileUpdateRequests = async (req, res) => {
    try {
        const { status = 'Pending', vendorModel, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { status };
        if (vendorModel) query.vendorModel = vendorModel;

        const [requests, total] = await Promise.all([
            ProfileUpdateRequest.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            ProfileUpdateRequest.countDocuments(query)
        ]);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            count: requests.length,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET: Request Details
// Endpoint: GET /api/admin/profile-update/:requestId
// ==========================================
const getProfileUpdateRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;

        const request = await ProfileUpdateRequest.findById(requestId).lean();
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found." });
        }

        const TargetModel = modelMap[request.vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: `Invalid model mapping for ${request.vendorModel}` });
        }

        // 1. Fetch current live profile from database
        const currentFullProfile = await TargetModel.findById(request.vendorId).select('-password -token').lean();

        // 2.  FILTER: Sirf wahi keys nikalenge jo 'updatedFields' me bheji gayi hain
        const updatedKeys = Object.keys(request.updatedFields || {});
        
        const filteredCurrentFields = {
            _id: currentFullProfile?._id || request.vendorId,
            vendorName: currentFullProfile?.clinicName || currentFullProfile?.name || "N/A"
        };

        if (currentFullProfile) {
            updatedKeys.forEach(key => {
                // Current DB me us field ki kya purani value thi
                filteredCurrentFields[key] = currentFullProfile[key] !== undefined ? currentFullProfile[key] : null;
            });
        }

        // 3. Clean Response (Only changed fields comparison)
        res.json({
            success: true,
            data: {
                requestId: request._id,
                vendorId: request.vendorId,
                vendorModel: request.vendorModel,
                status: request.status,
                rejectionReason: request.rejectionReason,
                createdAt: request.createdAt,
                
                //  Nayi values jo approve hone aayi hain
                updatedFields: request.updatedFields,

                //  Purani values database se (Sirf unhi fields ki)
                currentFields: filteredCurrentFields
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. POST: Process Profile Update Request (Approve/Reject)
// Endpoint: POST /api/admin/profile-update/:requestId/action
const handleProfileUpdateAction = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, reason } = req.body; // action: 'Approve' | 'Reject'

        const request = await ProfileUpdateRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Profile update request not found." });
        }

        if (request.status !== 'Pending') {
            return res.status(400).json({ success: false, message: `Request already processed. Status is: ${request.status}` });
        }

        const TargetModel = modelMap[request.vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: `Invalid vendor model type: ${request.vendorModel}` });
        }

        const singleFileKeys = ['profileImage', 'signatureImage', 'profilePic', 'image', 'posterimage', 'certificateImage', 'licenceCertificate'];

        if (action === 'Approve') {
            // --- 1. CLEANUP OLD FILES ON APPROVAL ---
            const currentProfile = await TargetModel.findById(request.vendorId).lean();
            if (currentProfile) {
                singleFileKeys.forEach(key => {
                    if (request.updatedFields[key] && currentProfile[key] && request.updatedFields[key] !== currentProfile[key]) {
                        deleteFile(currentProfile[key]);
                    }
                });
            }

            // --- 2. PREPARE UPDATE PAYLOAD ---
            let setQuery = { ...request.updatedFields };

            // 🎯 SIRF profileStatus ko 'Approved' kiya gaya hai (Accountverify ko nahi chheda hai)
            setQuery['profileStatus'] = 'Approved';
            setQuery['rejectionReason'] = null;
            setQuery['rejectReason'] = null;

            // Apply update to actual vendor document (runValidators: false avoids schema validation crash)
            const updatedVendor = await TargetModel.findByIdAndUpdate(
                request.vendorId,
                { $set: setQuery },
                { new: true, runValidators: false }
            );

            if (!updatedVendor) {
                return res.status(404).json({ success: false, message: "Target vendor record not found to update." });
            }
            
            request.status = 'Approved';
            request.rejectionReason = "";

        } else if (action === 'Reject') {
            const rejectMsg = reason || "Request declined by Administrator.";

            // --- 1. CLEANUP REJECTED NEW FILES ---
            singleFileKeys.forEach(key => {
                if (request.updatedFields[key]) {
                    deleteFile(request.updatedFields[key]);
                }
            });

            // --- 2. UPDATE VENDOR PROFILE STATUS TO REJECTED ---
            await TargetModel.findByIdAndUpdate(
                request.vendorId,
                { 
                    $set: { 
                        profileStatus: 'Rejected',
                        rejectionReason: rejectMsg 
                    } 
                },
                { new: true, runValidators: false }
            );

            request.status = 'Rejected';
            request.rejectionReason = rejectMsg;

        } else {
            return res.status(400).json({ success: false, message: "Invalid action type. Expected 'Approve' or 'Reject'." });
        }

        request.adminId = req.user ? req.user.id : null;
        await request.save();

        res.json({
            success: true,
            message: `Profile update request successfully ${request.status}!`,
            data: request
        });

    } catch (error) {
        console.error("Profile update action error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getProfileUpdateRequests, 
    getProfileUpdateRequestDetails, 
    handleProfileUpdateAction 
};