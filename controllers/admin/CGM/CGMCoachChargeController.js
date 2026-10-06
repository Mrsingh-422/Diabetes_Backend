// controllers/admin/CGM/CGMCoachChargeAdminController.js

const CGMAddon = require('../../../models/CGMAddon');

// 1. Create Coach Charge
const createCoachCharge = async (req, res) => {
    try {
        const { coachCharge, description } = req.body;

        if (coachCharge === undefined || coachCharge === "") {
            return res.status(400).json({ success: false, message: "Coach charge amount is required." });
        }

        const chargeValue = Number(coachCharge) || 0;

        const coachPlan = await CGMAddon.create({
            name: "Coach Charge",
            price: chargeValue,
            coachCharge: chargeValue,
            description: description || "",
            isActive: true
        });

        res.status(201).json({
            success: true,
            message: "Coach charge created successfully!",
            data: {
                _id: coachPlan._id,
                coachCharge: coachPlan.coachCharge,
                description: coachPlan.description,
                isActive: coachPlan.isActive,
                createdAt: coachPlan.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Get All Coach Charges
const getCoachCharges = async (req, res) => {
    try {
        const { activeOnly } = req.query;
        const filter = { coachCharge: { $gt: 0 } };

        if (activeOnly === 'true') filter.isActive = true;

        const coachCharges = await CGMAddon.find(filter)
            .select('_id coachCharge description isActive createdAt')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: coachCharges.length,
            data: coachCharges
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Get Single Coach Charge By ID
const getCoachChargeById = async (req, res) => {
    try {
        const { id } = req.params;
        const coachCharge = await CGMAddon.findById(id).select('_id coachCharge description isActive');

        if (!coachCharge || coachCharge.coachCharge === 0) {
            return res.status(404).json({ success: false, message: "Coach charge configuration not found." });
        }

        res.json({ success: true, data: coachCharge });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Update Coach Charge
const updateCoachCharge = async (req, res) => {
    try {
        const { id } = req.params;
        const { coachCharge, description } = req.body;

        const updateData = {};
        if (coachCharge !== undefined) {
            updateData.coachCharge = Number(coachCharge);
            updateData.price = Number(coachCharge);
        }
        if (description !== undefined) updateData.description = description;

        const updated = await CGMAddon.findByIdAndUpdate(
            id, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        ).select('_id coachCharge description isActive updatedAt');

        if (!updated) {
            return res.status(404).json({ success: false, message: "Coach charge not found." });
        }

        res.json({
            success: true,
            message: "Coach charge updated successfully!",
            data: updated
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Delete Coach Charge
const deleteCoachCharge = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await CGMAddon.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Coach charge not found." });
        }

        res.json({
            success: true,
            message: "Coach charge deleted successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. Toggle Coach Charge Status
const toggleCoachChargeActive = async (req, res) => {
    try {
        const { id } = req.params;
        const coachCharge = await CGMAddon.findById(id);

        if (!coachCharge) {
            return res.status(404).json({ success: false, message: "Coach charge not found." });
        }

        coachCharge.isActive = !coachCharge.isActive;
        await coachCharge.save();

        res.json({
            success: true,
            message: `Coach charge is now ${coachCharge.isActive ? 'Active' : 'Inactive'}`,
            data: {
                _id: coachCharge._id,
                coachCharge: coachCharge.coachCharge,
                description: coachCharge.description,
                isActive: coachCharge.isActive,
                updatedAt: coachCharge.updatedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCoachCharge,
    getCoachCharges,
    getCoachChargeById,
    updateCoachCharge,
    deleteCoachCharge,
    toggleCoachChargeActive
};