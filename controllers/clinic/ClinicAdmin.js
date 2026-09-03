// controllers/clinic/ClinicAdmin.js
const Clinic = require('../../models/Clinic'); 
const Doctor = require('../../models/Doctor');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');

// ==========================================
// 1. ADMIN: GET CLINICS WITH FILTERS & PAGINATION
// Endpoint: GET /api/admin/clinic/list?status=Pending&isActive=true&page=1&limit=10
// ==========================================
const getClinics = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, isActive, search } = req.query;
        const query = {};

        if (status) {
            query.Accountverify = status;
        }

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (search) {
            query.$or = [
                { name: new RegExp(search, 'i') },
                { clinicName: new RegExp(search, 'i') }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const clinics = await Clinic.find(query)
            .select('-password')
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

// ==========================================
// 2. ADMIN: APPROVE OR REJECT CLINIC STATUS
// Endpoint: PATCH /api/admin/clinic/approve/:id
// ==========================================
const approveClinicStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body;

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value. Allowed: Approved, Rejected, Pending" });
        }

        const clinic = await Clinic.findById(id);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        clinic.Accountverify = status;
        clinic.profileStatus = status;

        if (status === 'Rejected') {
            if (!rejectionReason) {
                return res.status(400).json({ success: false, message: "Rejection reason is required when status is Rejected." });
            }
            clinic.rejectionReason = rejectionReason;
            clinic.rejectReason = rejectionReason;
        } else {
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

// ==========================================
// 3. ADMIN: TOGGLE CLINIC ACTIVE/INACTIVE STATUS
// Endpoint: PATCH /api/admin/clinic/toggle-active/:id
// ==========================================
const toggleClinicActiveStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const clinic = await Clinic.findById(id);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

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

// ==========================================
// 4. ADMIN: GET APPROVED CLINICS LIST
// Endpoint: GET /api/admin/clinic/approved-list?page=1
// ==========================================
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

// ==========================================
// 🚀 5. ADMIN: GET CLINIC DOCTORS (With Filters & Search)
// Endpoint: GET /api/admin/clinic/doctors/list?status=Pending&clinicId=...&search=...
// ==========================================
const getClinicDoctorsAdmin = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, clinicId, search, speciality, isActive } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Filter strictly for Clinic-associated Doctors
        const query = {
            $or: [
                { role: 'clinic-doctor' },
                { clinicId: { $ne: null, $exists: true } }
            ]
        };

        if (status) {
            query.profileStatus = status; // 'Pending' | 'Approved' | 'Rejected'
        }

        if (clinicId) {
            query.clinicId = clinicId;
        }

        if (speciality) {
            query.speciality = new RegExp(speciality, 'i');
        }

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (search) {
            query.$or = [
                { name: new RegExp(search, 'i') },
                { phone: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') },
                { licenseNumber: new RegExp(search, 'i') }
            ];
        }

        // 🚀 ONLY MAIN FIELDS SELECTED (Fast & Lightweight)
        const doctors = await Doctor.find(query)
            .select('name profileImage phone email speciality qualification experienceYears licenseNumber fees profileStatus dutyStatus isActive rejectionReason createdAt clinicId')
            .populate('clinicId', 'clinicName name city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Doctor.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            count: doctors.length,
            data: doctors
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚀 6. ADMIN: GET SINGLE CLINIC DOCTOR DETAILS
// Endpoint: GET /api/admin/clinic/doctors/details/:id
// ==========================================
const getClinicDoctorDetailsAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const doctor = await Doctor.findById(id)
            .select('-password -token')
            .populate('clinicId', 'clinicName name phoneNumber email city state address image');

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Clinic doctor not found." });
        }

        res.json({
            success: true,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚀 7. ADMIN: APPROVE OR REJECT CLINIC DOCTOR
// Endpoint: PATCH /api/admin/clinic/doctors/approve/:id
// ==========================================
const approveClinicDoctorStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body; // status: 'Approved' | 'Rejected' | 'Pending'

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status. Allowed values: 'Approved', 'Rejected', 'Pending'"
            });
        }

        const doctor = await Doctor.findById(id);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        doctor.profileStatus = status;

        if (status === 'Approved') {
            doctor.rejectionReason = null;
            doctor.isActive = true;
            doctor.dutyStatus = 'On Duty';
        } else if (status === 'Rejected') {
            if (!rejectionReason) {
                return res.status(400).json({
                    success: false,
                    message: "Rejection reason is required when rejecting doctor profile."
                });
            }
            doctor.rejectionReason = rejectionReason;
            doctor.isOnline = false;
            doctor.dutyStatus = 'Off Duty';
        }

        await doctor.save();

        // 🔄 Sync Admin ProfileUpdateRequest queue if exists
        await ProfileUpdateRequest.updateMany(
            { vendorId: doctor._id, vendorModel: 'Doctor', status: 'Pending' },
            {
                $set: {
                    status: status,
                    rejectionReason: status === 'Rejected' ? rejectionReason : "",
                    adminId: req.user ? req.user.id : null
                }
            }
        );

        res.json({
            success: true,
            message: `Dr. ${doctor.name} profile status updated to ${status}.`,
            data: {
                id: doctor._id,
                name: doctor.name,
                profileStatus: doctor.profileStatus,
                rejectionReason: doctor.rejectionReason
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinics,
    approveClinicStatus,
    toggleClinicActiveStatus,
    adminGetApprovedClinics,
    // Doctor Admin Controllers
    getClinicDoctorsAdmin,
    getClinicDoctorDetailsAdmin,
    approveClinicDoctorStatus
};