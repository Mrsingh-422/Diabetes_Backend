// controllers/provider/Food/VendorSmoothieDrinkController.js

const smoothiDrinks = require('../../../models/smoothiDrinks');
const VendorSmoothieDrink = require('../../../models/VendorSmoothieDrink');
const mongoose = require('mongoose');

// ==========================================
// 🥤 1. GET MASTER DRINKS CHECKLIST FOR KITCHEN (NO CUSTOM PRICING)
// Full Path: GET /provider/food/drinks/master-catalog
// ==========================================
const getMasterSmoothieDrinksForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { drinkType, foodEffectCategory, dietType } = req.query;

        const filter = { isActive: true };
        if (drinkType) filter.drinkType = drinkType;
        if (dietType) filter.dietType = dietType;
        if (foodEffectCategory) filter.foodEffectCategory = new RegExp(`^${foodEffectCategory.trim()}$`, 'i');

        const masterDrinks = await smoothiDrinks.find(filter)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorSmoothieDrink.find({ vendorId }).lean();

        const checklist = masterDrinks.map(drink => {
            const mapping = vendorMappings.find(
                m => m.drinkId.toString() === drink._id.toString()
            );

            return {
                ...drink,
                isAvailable: mapping ? mapping.isAvailable : false
            };
        });

        res.json({
            success: true,
            count: checklist.length,
            data: checklist
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🥤 2. MULTI-SYNC DRINKS SELECTION (ONLY AVAILABILITY SYNC)
// Full Path: POST /provider/food/drinks/sync
// ==========================================
const syncSmoothieDrinks = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { selectedDrinkIds = [] } = req.body;

        if (!Array.isArray(selectedDrinkIds)) {
            return res.status(400).json({ success: false, message: "selectedDrinkIds must be an array of Drink IDs." });
        }

        const allMasterDrinks = await smoothiDrinks.find({ isActive: true }).select('_id').lean();

        const operations = allMasterDrinks.map(drink => {
            const drinkIdStr = drink._id.toString();
            const isSelected = selectedDrinkIds.map(id => id.toString()).includes(drinkIdStr);

            return {
                updateOne: {
                    filter: { vendorId, drinkId: drink._id },
                    update: { $set: { isAvailable: isSelected } },
                    upsert: true
                }
            };
        });

        if (operations.length > 0) {
            await VendorSmoothieDrink.bulkWrite(operations);
        }

        res.json({
            success: true,
            message: `Smoothies & Drinks menu synchronized successfully! (${selectedDrinkIds.length} Active Drinks)`,
            activeDrinksCount: selectedDrinkIds.length
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 3. INSTANT SINGLE DRINK AVAILABILITY TOGGLE
// Full Path: PATCH /provider/food/drinks/toggle/:drinkId
// ==========================================
const toggleSmoothieDrinkAvailability = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { drinkId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(drinkId)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID." });
        }

        const existing = await VendorSmoothieDrink.findOne({ vendorId, drinkId });
        const newStatus = existing ? !existing.isAvailable : true;

        const mapping = await VendorSmoothieDrink.findOneAndUpdate(
            { vendorId, drinkId },
            { $set: { isAvailable: newStatus } },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: `Drink availability set to ${newStatus ? 'Active' : 'Inactive'} successfully.`,
            isAvailable: newStatus,
            data: mapping
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📦 4. GET ALL VENDOR DRINKS INVENTORY LIST
// Full Path: GET /provider/food/drinks/my-drinks
// ==========================================
const getVendorSmoothieDrinks = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { isAvailable, drinkType, foodEffectCategory } = req.query;

        const query = { isActive: true };
        if (drinkType) query.drinkType = drinkType;
        if (foodEffectCategory) query.foodEffectCategory = new RegExp(`^${foodEffectCategory.trim()}$`, 'i');

        const masterDrinks = await smoothiDrinks.find(query)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorSmoothieDrink.find({ vendorId }).lean();

        let result = masterDrinks.map(drink => {
            const mapping = vendorMappings.find(
                m => m.drinkId.toString() === drink._id.toString()
            );

            return {
                ...drink,
                isAvailable: mapping ? mapping.isAvailable : false
            };
        });

        if (isAvailable !== undefined) {
            const statusBool = isAvailable === 'true';
            result = result.filter(d => d.isAvailable === statusBool);
        }

        result.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        res.json({
            success: true,
            count: result.length,
            data: result
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 5. GET SINGLE VENDOR DRINK DETAILS BY ID
// Full Path: GET /provider/food/drinks/:drinkId
// ==========================================
const getVendorSmoothieDrinkById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { drinkId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(drinkId)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID." });
        }

        const drink = await smoothiDrinks.findById(drinkId)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item not found." });
        }

        const mapping = await VendorSmoothieDrink.findOne({ vendorId, drinkId: drink._id }).lean();

        res.json({
            success: true,
            data: {
                ...drink,
                isAvailable: mapping ? mapping.isAvailable : false
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getMasterSmoothieDrinksForSelection,
    syncSmoothieDrinks,
    toggleSmoothieDrinkAvailability,
    getVendorSmoothieDrinks,
    getVendorSmoothieDrinkById
};