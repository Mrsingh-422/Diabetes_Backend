const Doctor = require('../../models/Doctor');
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Food = require('../../models/Food');
const Ambulance = require('../../models/Ambulance');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const { getLocationFilter } = require('../../middleware/authMiddleware');

// Helper function to handle listing with Search and Pagination
// const getPaginatedList = async (Model, req, res, searchFields = [], populateFields = null) => {
//     try {
//         const { status, page = 1, limit = 10, search = "" } = req.query;
//         const locFilter = getLocationFilter(req);

//         const filter = { ...locFilter };
//         if (status) filter.profileStatus = status;

//         if (search && searchFields.length > 0) {
//             filter.$or = searchFields.map(field => ({
//                 [field]: { $regex: search, $options: 'i' }
//             }));
//         }

//         const skip = (page - 1) * limit;
//         const totalDocs = await Model.countDocuments(filter);
        
//         let query = Model.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
//         if (populateFields) query = query.populate(populateFields);

//         const data = await query;

//         res.json({
//             success: true,
//             totalDocs,
//             totalPages: Math.ceil(totalDocs / limit),
//             currentPage: parseInt(page),
//             data
//         });
//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };

const getPaginatedList = async (Model, req, res, searchFields = [], populateFields = null) => {
    try {
        // Query parameters me geographic parameters add kiye
        const { status, page = 1, limit = 10, search = "", country, state, city } = req.query;
        const locFilter = getLocationFilter(req);
 
        const filter = { ...locFilter };
        if (status) filter.profileStatus = status;
 
        // Custom Dropdown query support
        if (country) filter.country = { $regex: country, $options: 'i' };
        if (state) filter.state = { $regex: state, $options: 'i' };
        if (city) filter.city = { $regex: city, $options: 'i' };
 
        if (search && searchFields.length > 0) {
            filter.$or = searchFields.map(field => ({
                [field]: { $regex: search, $options: 'i' }
            }));
        }
 
        const skip = (page - 1) * limit;
        const totalDocs = await Model.countDocuments(filter);
       
        let query = Model.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
        if (populateFields) query = query.populate(populateFields);
 
        const data = await query;
 
        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: parseInt(page),
            data
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 

// --- DOCTOR ---
// const getDoctorsList = (req, res) => getPaginatedList(Doctor, req, res, ['name', 'email', 'specialization'], { path: 'hospitalId', select: 'name email' });

const approveDoctor = async (req, res) => {
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Doctor approved', data: doctor });
};

const rejectDoctor = async (req, res) => {
    const { reason } = req.body;
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Doctor rejected', data: doctor });
};



// --- LAB ---
const getLabsList = (req, res) => getPaginatedList(Lab, req, res, ['name', 'email']);

const approveLab = async (req, res) => {
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Lab approved', data: lab });
};

const rejectLab = async (req, res) => {
    const { reason } = req.body;
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Lab rejected', data: lab });
};

// --- PHARMACY ---
const getPharmaciesList = (req, res) => getPaginatedList(Pharmacy, req, res, ['name', 'email']);

const approvePharmacy = async (req, res) => {
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Pharmacy approved', data: pharmacy });
};

const rejectPharmacy = async (req, res) => {
    const { reason } = req.body;
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Pharmacy rejected', data: pharmacy });
};

// --- Food ---
const getFoodsList = (req, res) => getPaginatedList(Food, req, res, ['name', 'email']);

const approveFood = async (req, res) => {
    try {
        // FIXED: Renamed the return variable to 'updatedFood' to prevent ReferenceErrors
        const updatedFood = await Food.findByIdAndUpdate(
            req.params.id, 
            { profileStatus: 'Approved', rejectionReason: null }, 
            { new: true }
        );
        if (!updatedFood) return res.status(404).json({ success: false, message: 'Food partner not found' });
        
        res.json({ success: true, message: 'Food approved', data: updatedFood });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const rejectFood = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required' });

        // FIXED: Renamed the return variable to 'updatedFood' to prevent ReferenceErrors
        const updatedFood = await Food.findByIdAndUpdate(
            req.params.id, 
            { profileStatus: 'Rejected', rejectionReason: reason }, 
            { new: true }
        );
        if (!updatedFood) return res.status(404).json({ success: false, message: 'Food partner not found' });

        res.json({ success: true, message: 'Food rejected', data: updatedFood });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚑 1. GET CLINIC AMBULANCES LIST (Admin Approval Queue)
// Endpoint: GET /api/admin/approval/ambulance?status=Pending&page=1&limit=10
// ==========================================
const getClinicAmbulancesList = async (req, res) => {
    try {
        const { status, page = 1, limit = 10, search = "", country, state, city, clinicId } = req.query;
        const locFilter = getLocationFilter(req);

        // Filter strictly for Clinic-associated Ambulances
        const filter = { 
            ...locFilter,
            $or: [
                { role: 'clinic-ambulance' },
                { clinicId: { $ne: null, $exists: true } }
            ]
        };

        if (status) filter.profileStatus = status; // 'Pending' | 'Approved' | 'Rejected'
        if (clinicId) filter.clinicId = clinicId;
        if (country) filter.country = { $regex: country, $options: 'i' };
        if (state) filter.state = { $regex: state, $options: 'i' };
        if (city) filter.city = { $regex: city, $options: 'i' };

        if (search && search.trim() !== "") {
            filter.$and = [
                {
                    $or: [
                        { name: { $regex: search.trim(), $options: 'i' } },
                        { phone: { $regex: search.trim(), $options: 'i' } },
                        { email: { $regex: search.trim(), $options: 'i' } },
                        { vehicleNumber: { $regex: search.trim(), $options: 'i' } }
                    ]
                }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalDocs = await Ambulance.countDocuments(filter);

        const data = await Ambulance.find(filter)
            .select('-password -token -fcmToken')
            .populate('clinicId', 'clinicName name phoneNumber city state address')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit)),
            currentPage: parseInt(page),
            count: data.length,
            data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚑 2. APPROVE CLINIC AMBULANCE
// Endpoint: PATCH /api/admin/approval/ambulance/approve/:id
// ==========================================
const approveClinicAmbulance = async (req, res) => {
    try {
        const ambulance = await Ambulance.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    profileStatus: 'Approved',
                    rejectionReason: null,
                    isActive: true,
                    availableForEmergency: true
                }
            },
            { new: true }
        ).select('-password -token');

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        // 🔄 Sync Admin ProfileUpdateRequest queue
        await ProfileUpdateRequest.updateMany(
            { vendorId: ambulance._id, vendorModel: 'Ambulance', status: 'Pending' },
            { 
                $set: { 
                    status: 'Approved', 
                    rejectionReason: '', 
                    adminId: req.user ? req.user.id : null 
                } 
            }
        );

        res.json({
            success: true,
            message: `Ambulance '${ambulance.vehicleNumber}' approved successfully.`,
            data: ambulance
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚑 3. REJECT CLINIC AMBULANCE (With Rejection Reason)
// Endpoint: PATCH /api/admin/approval/ambulance/reject/:id
// ==========================================
const rejectClinicAmbulance = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason || reason.trim() === "") {
            return res.status(400).json({ success: false, message: "Rejection reason is required." });
        }

        const ambulance = await Ambulance.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    profileStatus: 'Rejected',
                    rejectionReason: reason.trim(),
                    availableForEmergency: false,
                    isOnline: false
                }
            },
            { new: true }
        ).select('-password -token');

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        // 🔄 Sync Admin ProfileUpdateRequest queue
        await ProfileUpdateRequest.updateMany(
            { vendorId: ambulance._id, vendorModel: 'Ambulance', status: 'Pending' },
            { 
                $set: { 
                    status: 'Rejected', 
                    rejectionReason: reason.trim(), 
                    adminId: req.user ? req.user.id : null 
                } 
            }
        );

        res.json({
            success: true,
            message: `Ambulance '${ambulance.vehicleNumber}' rejected.`,
            data: ambulance
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    // getDoctorsList, 
    approveDoctor, rejectDoctor,
    
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,
    getFoodsList, approveFood, rejectFood,getClinicAmbulancesList, approveClinicAmbulance, rejectClinicAmbulance
};