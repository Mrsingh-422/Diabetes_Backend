// controllers/admin/Food/TiffinPlanAdminController.js

const TiffinPlan = require('../../../models/TiffinPlan');
const FoodService = require('../../../models/FoodService');

// --- 1. CREATE SUBSCRIPTION PLAN ---
const createTiffinPlan = async (req, res) => {
    try {
        const { 
            name, 
            planCycle, 
            mealsPerDay, 
            price, 
            permittedSlots, 
            dishPool, 
            description 
        } = req.body;

        if (!name || !planCycle || !mealsPerDay || !price || !permittedSlots || !dishPool || !description) {
            return res.status(400).json({ success: false, message: "All required fields must be provided." });
        }

        if (!Array.isArray(permittedSlots) || permittedSlots.length === 0) {
            return res.status(400).json({ success: false, message: "At least one permitted meal slot must be selected." });
        }

        if (!Array.isArray(dishPool) || dishPool.length === 0) {
            return res.status(400).json({ success: false, message: "At least one dish must be selected in the dish selection pool." });
        }

        // Auto-generate Plan ID (E.g. PLN-101, PLN-102)
        const count = await TiffinPlan.countDocuments();
        const planId = `PLN-${101 + count}`;

        const newPlan = await TiffinPlan.create({
            planId,
            name,
            planCycle,
            mealsPerDay: Number(mealsPerDay),
            price: Number(price),
            permittedSlots,
            dishPool,
            description
        });

        res.status(201).json({
            success: true,
            message: "Subscription plan created successfully!",
            data: newPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET ALL SUBSCRIPTION PLANS (Admin Dashboard Grid) ---
const getAllTiffinPlans = async (req, res) => {
    try {
        const plans = await TiffinPlan.find()
            .populate({
                path: 'dishPool',
                select: 'name imageUrl price discountPrice dietType calories'
            })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: plans.length,
            data: plans
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. GET SINGLE PLAN DETAILS BY ID ---
const getTiffinPlanById = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await TiffinPlan.findOne({
            $or: [{ _id: id }, { planId: id }]
        }).populate({
            path: 'dishPool',
            select: 'name imageUrl price discountPrice dietType calories ingredients tags foodEffectCategory'
        });

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            data: plan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. UPDATE SUBSCRIPTION PLAN ---
const updateTiffinPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        const plan = await TiffinPlan.findOneAndUpdate(
            { $or: [{ _id: id }, { planId: id }] },
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('dishPool', 'name imageUrl price discountPrice');

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            message: "Subscription plan updated successfully!",
            data: plan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. DELETE SUBSCRIPTION PLAN ---
const deleteTiffinPlan = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await TiffinPlan.findOneAndDelete({
            $or: [{ _id: id }, { planId: id }]
        });

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            message: "Subscription plan removed successfully."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. TOGGLE ACTIVE STATUS SWITCH ---
const toggleTiffinPlanStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await TiffinPlan.findOne({ $or: [{ _id: id }, { planId: id }] });
        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        const updatedPlan = await TiffinPlan.findByIdAndUpdate(
            plan._id,
            { $set: { isActive: !plan.isActive } },
            { new: true }
        );

        res.json({
            success: true,
            message: `Plan status updated to ${updatedPlan.isActive ? 'Active' : 'Inactive'}`,
            isActive: updatedPlan.isActive,
            data: updatedPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTiffinPlan,
    getAllTiffinPlans,
    getTiffinPlanById,
    updateTiffinPlan,
    deleteTiffinPlan,
    toggleTiffinPlanStatus
};