const Doctor = require('../../models/Doctor');
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Food = require('../../models/Food');
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
    const Food = await Food.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Food approved', data: Food });
};

const rejectFood = async (req, res) => {
    const { reason } = req.body;
    const Food = await Food.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Food rejected', data: Food });
};



module.exports = {
    // getDoctorsList, 
    approveDoctor, rejectDoctor,
    
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,
    getFoodsList, approveFood, rejectFood,
};