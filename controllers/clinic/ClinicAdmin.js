const Clinic = require('../../models/Clinic'); 

// --- 1. ADMIN: GET CLINICS WITH FILTERS & PAGINATION ---
// Endpoint: GET /api/admin/clinic/list?status=Pending&isActive=true&page=1&limit=10
const getClinics = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, isActive, search } = req.query;
        const query = {};

        // Status filter (using Accountverify as defined in Schema)
        if (status) {
            query.Accountverify = status;
        }

        // Active / Inactive filter
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        // Search logic (Checks either Owner Name or Clinic Name case-insensitive)
        if (search) {
            query.$or = [
                { name: new RegExp(search, 'i') },
                { clinicName: new RegExp(search, 'i') }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const clinics = await Clinic.find(query)
            .select('-password') // Hide secure password hash
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Clinic.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            count: clinics.length,
            data: clinics
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: APPROVE OR REJECT CLINIC STATUS ---
// Endpoint: PATCH /api/admin/clinic/approve/:id
const approveClinicStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body; // status can be: 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value. Allowed: Approved, Rejected, Pending" });
        }

        const clinic = await Clinic.findById(id);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        // Set global verification status
        clinic.Accountverify = status;

        if (status === 'Rejected') {
            if (!rejectionReason) {
                return res.status(400).json({ success: false, message: "Rejection reason is required when status is Rejected." });
            }
            // Keep both legacy rejectReason and new rejectionReason in sync
            clinic.rejectionReason = rejectionReason;
            clinic.rejectReason = rejectionReason;
        } else {
            // Clear reasons on approval
            clinic.rejectionReason = null;
            clinic.rejectReason = "";
        }

        await clinic.save();

        res.json({
            success: true,
            message: `Clinic status successfully updated to ${status}.`,
            data: clinic
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. ADMIN: TOGGLE CLINIC ACTIVE/INACTIVE STATUS ---
// Endpoint: PATCH /api/admin/clinic/toggle-active/:id
const toggleClinicActiveStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const clinic = await Clinic.findById(id);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        // Toggle the boolean value
        clinic.isActive = !clinic.isActive;
        await clinic.save();

        res.json({
            success: true,
            message: `Clinic is now ${clinic.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                id: clinic._id,
                isActive: clinic.isActive
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. ADMIN: GET APPROVED CLINICS LIST (Limit: 25) ---
// Endpoint: GET /api/admin/clinic/approved-list?page=1
const adminGetApprovedClinics = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { Accountverify: 'Approved' };

        const clinics = await Clinic.find(query)
            .select('name clinicName address city state image posterimage Accountverify isActive')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Clinic.countDocuments(query);

        res.json({
            success: true,
            count: clinics.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: clinics
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinics,
    approveClinicStatus,
    toggleClinicActiveStatus,
    adminGetApprovedClinics
};