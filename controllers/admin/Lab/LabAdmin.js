// controllers/admin/Lab/LabAdmin.js

const LabBooking = require('../../../models/LabBooking');
const Lab = require('../../../models/Lab');

// --- 1. ADMIN: GET ALL LABS WITH FILTERS & PAGINATION ---
// Endpoint: GET /admin/lab/list?status=Pending&isActive=true&page=1&limit=10
const adminGetLabs = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, isActive, search } = req.query;
        const query = {};

        // Status filter (e.g. Incomplete, Pending, Approved, Rejected)
        if (status) {
            query.profileStatus = status;
        }

        // Active / Inactive filter
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        // Search logic (Checks either Lab Name, Email or Phone case-insensitive)
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const labs = await Lab.find(query)
            .select('-password') // Hide secure password hash
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Lab.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            count: labs.length,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: APPROVE OR REJECT LAB PROFILE STATUS (Unified Endpoint) ---
// Endpoint: PATCH /admin/lab/approve/:labId
const approveLabStatus = async (req, res) => {
    try {
        const { labId } = req.params;
        const { status, rejectionReason } = req.body; // status can be: 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid status value. Allowed: Approved, Rejected, Pending" 
            });
        }

        const lab = await Lab.findById(labId);
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }

        // Set verification status
        lab.profileStatus = status;

        if (status === 'Rejected') {
            if (!rejectionReason || rejectionReason.trim() === "") {
                return res.status(400).json({ 
                    success: false, 
                    message: "Rejection reason is required when status is Rejected." 
                });
            }
            lab.rejectionReason = rejectionReason;
        } else {
            // Clear verification reasons on approval or resetting to pending
            lab.rejectionReason = null;
        }

        await lab.save();

        res.json({
            success: true,
            message: `Lab status successfully updated to ${status}.`,
            data: {
                labId: lab._id,
                profileStatus: lab.profileStatus,
                rejectionReason: lab.rejectionReason
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. ADMIN: TOGGLE ACTIVE/INACTIVE STATUS ---
// Endpoint: PATCH /admin/lab/toggle-active/:labId
const toggleActiveInactiveLab = async (req, res) => {
    try {
        const { labId } = req.params;
        const lab = await Lab.findById(labId);
 
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }
 
        // Toggle the boolean value
        lab.isActive = !lab.isActive;
        await lab.save();
 
        return res.json({
            success: true,
            message: `Lab status updated to ${lab.isActive ? 'Active' : 'Inactive'}.`,
            data: { 
                labId: lab._id,
                isActive: lab.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};

// --- 4. ADMIN: GET APPROVED LABS LIST (Legacy / Quick Retrieval) ---
// Endpoint: GET /admin/lab/approved-list?page=1
const adminGetApprovedLabs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const labs = await Lab.find(query)
            .select('name email phone city profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Lab.countDocuments(query);

        res.json({
            success: true,
            count: labs.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. ADMIN: GET LAB BOOKINGS ---
// Endpoint: GET /admin/lab/bookings?labId=ID&page=1
const adminGetLabBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; 
        const skip = (page - 1) * limit;
        const { status, userId, labId } = req.query; 

        let query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (labId) query.labId = labId; 

        const bookings = await LabBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('labId', 'name city profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await LabBooking.countDocuments(query);
            
        res.json({ 
            success: true, 
            count: bookings.length, 
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
 
module.exports = { 
    adminGetLabs,
    approveLabStatus,
    toggleActiveInactiveLab,
    adminGetApprovedLabs,
    adminGetLabBookings
};