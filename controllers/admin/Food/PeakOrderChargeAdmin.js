// controllers/admin/Food/PeakOrderChargeAdminController.js

const PeakOrderCharge = require('../../../models/PeakOrderCharge');

// ==========================================
// 🔍 1. GET PEAK ORDER CHARGES CONFIG
// Full Path: GET /admin/food/peak-charges
// ==========================================
const getPeakOrderCharges = async (req, res) => {
    try {
        let config = await PeakOrderCharge.findOne({ vendorType: 'Food' });

        // Agar DB me pehli baar nahi mila toh default config create karein
        if (!config) {
            config = await PeakOrderCharge.create({
                vendorType: 'Food',
                breakfast: { charge: 0, isActive: false },
                lunch: { charge: 0, isActive: false },
                dinner: { charge: 0, isActive: false },
                isGlobalActive: true
            });
        }

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💾 2. SAVE / UPDATE PEAK ORDER CHARGES
// Full Path: POST /admin/food/peak-charges/save
// ==========================================
const savePeakOrderCharges = async (req, res) => {
    try {
        const adminId = req.user.id;
        const { breakfast, lunch, dinner, isGlobalActive } = req.body;

        const updateData = { updatedBy: adminId };

        if (breakfast) {
            if (breakfast.charge !== undefined) updateData["breakfast.charge"] = Number(breakfast.charge);
            if (breakfast.isActive !== undefined) updateData["breakfast.isActive"] = Boolean(breakfast.isActive);
        }

        if (lunch) {
            if (lunch.charge !== undefined) updateData["lunch.charge"] = Number(lunch.charge);
            if (lunch.isActive !== undefined) updateData["lunch.isActive"] = Boolean(lunch.isActive);
        }

        if (dinner) {
            if (dinner.charge !== undefined) updateData["dinner.charge"] = Number(dinner.charge);
            if (dinner.isActive !== undefined) updateData["dinner.isActive"] = Boolean(dinner.isActive);
        }

        if (isGlobalActive !== undefined) {
            updateData.isGlobalActive = Boolean(isGlobalActive);
        }

        const config = await PeakOrderCharge.findOneAndUpdate(
            { vendorType: 'Food' },
            { $set: updateData },
            { new: true, upsert: true, runValidators: true }
        );

        res.json({
            success: true,
            message: "Peak order charges updated successfully!",
            data: config
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 3. TOGGLE SINGLE SLOT ACTIVE / INACTIVE STATUS
// Full Path: PATCH /admin/food/peak-charges/toggle-slot/:slotName
// ==========================================
const toggleSlotPeakChargeStatus = async (req, res) => {
    try {
        const { slotName } = req.params; // 'breakfast', 'lunch', 'dinner', ya 'global'
        const cleanSlot = slotName.toLowerCase().trim();

        if (!['breakfast', 'lunch', 'dinner', 'global'].includes(cleanSlot)) {
            return res.status(400).json({
                success: false,
                message: "Invalid slot name. Valid options are: 'breakfast', 'lunch', 'dinner', 'global'."
            });
        }

        let config = await PeakOrderCharge.findOne({ vendorType: 'Food' });
        if (!config) {
            config = await PeakOrderCharge.create({ vendorType: 'Food' });
        }

        let updatedField = {};
        let newStatus = false;

        if (cleanSlot === 'global') {
            newStatus = !config.isGlobalActive;
            config.isGlobalActive = newStatus;
            updatedField = { isGlobalActive: newStatus };
        } else {
            newStatus = !config[cleanSlot].isActive;
            config[cleanSlot].isActive = newStatus;
            updatedField = { [`${cleanSlot}.isActive`]: newStatus };
        }

        await config.save();

        res.json({
            success: true,
            message: `${cleanSlot.toUpperCase()} peak order charge is now ${newStatus ? 'Active' : 'Inactive'}.`,
            slot: cleanSlot,
            isActive: newStatus,
            data: config
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getPeakOrderCharges,
    savePeakOrderCharges,
    toggleSlotPeakChargeStatus
};