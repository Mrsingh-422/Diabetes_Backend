// controllers/admin/others/ambulanceFacilityController.js
const AmbulanceFacility = require('../../../models/AmbulanceFacility');

// 1. CREATE FACILITY
const createAmbulanceFacility = async (req, res) => {
    try {
        const { name, description, defaultPrice, applicableFor } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: "Facility name is required." });
        }

        const existing = await AmbulanceFacility.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
        if (existing) {
            return res.status(400).json({ success: false, message: `'${name}' already exists.` });
        }

        const facility = await AmbulanceFacility.create({
            name: name.trim(),
            description: description || "",
            defaultPrice: Number(defaultPrice) || 0,
            applicableFor: applicableFor || 'all',
            createdBy: req.user?._id || null
        });

        res.status(201).json({
            success: true,
            message: "Ambulance facility created successfully.",
            data: facility
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET ALL FACILITIES (With optional filtering)
const getAllAmbulanceFacilities = async (req, res) => {
    try {
        const { applicableFor, isActive, search } = req.query;
        let query = {};

        if (applicableFor) {
            query.$or = [{ applicableFor }, { applicableFor: 'all' }];
        }
        if (isActive !== undefined) {
            query.isActive = isActive === 'true' || isActive === true;
        }
        if (search && search.trim() !== '') {
            query.name = { $regex: search.trim(), $options: 'i' };
        }

        const facilities = await AmbulanceFacility.find(query).sort({ createdAt: -1 });

        res.json({
            success: true,
            count: facilities.length,
            data: facilities
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET SINGLE FACILITY BY ID
const getSingleAmbulanceFacility = async (req, res) => {
    try {
        const { id } = req.params;
        const facility = await AmbulanceFacility.findById(id);

        if (!facility) {
            return res.status(404).json({ success: false, message: "Facility not found." });
        }

        res.json({ success: true, data: facility });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. UPDATE FACILITY
const updateAmbulanceFacility = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, defaultPrice, applicableFor, isActive } = req.body;

        const facility = await AmbulanceFacility.findById(id);
        if (!facility) {
            return res.status(404).json({ success: false, message: "Facility not found." });
        }

        if (name && name.trim() !== facility.name) {
            const exists = await AmbulanceFacility.findOne({ 
                _id: { $ne: id }, 
                name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } 
            });
            if (exists) {
                return res.status(400).json({ success: false, message: `'${name}' already exists.` });
            }
            facility.name = name.trim();
        }

        if (description !== undefined) facility.description = description;
        if (defaultPrice !== undefined) facility.defaultPrice = Number(defaultPrice);
        if (applicableFor !== undefined) facility.applicableFor = applicableFor;
        if (isActive !== undefined) facility.isActive = Boolean(isActive);

        await facility.save();

        res.json({
            success: true,
            message: "Ambulance facility updated successfully.",
            data: facility
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. TOGGLE ACTIVE STATUS
const toggleAmbulanceFacilityStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const facility = await AmbulanceFacility.findById(id);

        if (!facility) {
            return res.status(404).json({ success: false, message: "Facility not found." });
        }

        facility.isActive = !facility.isActive;
        await facility.save();

        res.json({
            success: true,
            message: `Facility is now ${facility.isActive ? 'Active' : 'Inactive'}.`,
            isActive: facility.isActive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. DELETE FACILITY
const deleteAmbulanceFacility = async (req, res) => {
    try {
        const { id } = req.params;
        const facility = await AmbulanceFacility.findByIdAndDelete(id);

        if (!facility) {
            return res.status(404).json({ success: false, message: "Facility not found." });
        }

        res.json({
            success: true,
            message: "Ambulance facility deleted successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createAmbulanceFacility,
    getAllAmbulanceFacilities,
    getSingleAmbulanceFacility,
    updateAmbulanceFacility,
    toggleAmbulanceFacilityStatus,
    deleteAmbulanceFacility
};