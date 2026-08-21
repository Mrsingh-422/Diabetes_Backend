// controllers/provider/Food/FoodInventoryController.js

const VendorFoodItem = require('../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../models/VendorFoodCombo');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const mongoose = require('mongoose');

// ==========================================
// 🍔 1. MEALS INVENTORY CRUD SECTION
// ==========================================

// --- 1.1 GET MASTER CATALOG CHECKLIST ---
const getMasterCatalogForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;

        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorFoodItem.find({ vendorId }).lean();

        const selectionChecklist = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            return {
                ...meal,
                isAvailable: mapping ? mapping.isAvailable : false, // 👈 Pre-filled checkbox key
                customPrice: mapping ? mapping.price : null,
                customDiscountPrice: mapping ? mapping.discountPrice : null
            };
        });

        res.json({ success: true, count: selectionChecklist.length, data: selectionChecklist });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.2 GET SINGLE MENU ITEM DETAIL BY ID ---
const getVendorMenuItemById = async (req, res) => {
    try {
        const { id } = req.params; // foodServiceId from URL
        const vendorId = req.user.id;

        const meal = await FoodService.findById(id)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!meal) {
            return res.status(404).json({ success: false, message: "Master food item not found." });
        }

        const mapping = await VendorFoodItem.findOne({ vendorId, foodServiceId: id }).lean();

        res.json({
            success: true,
            data: {
                ...meal,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.price : null,
                customDiscountPrice: mapping ? mapping.discountPrice : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.3 SELECT/ADD FOOD ITEMS TO MENU ---
const selectFoodItems = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodServiceIds } = req.body;

        if (!foodServiceIds || !Array.isArray(foodServiceIds)) {
            return res.status(400).json({ success: false, message: "foodServiceIds array is required." });
        }

        const operations = foodServiceIds.map(id => ({
            updateOne: {
                filter: { vendorId, foodServiceId: id },
                update: { $set: { isAvailable: true } },
                upsert: true
            }
        }));

        await VendorFoodItem.bulkWrite(operations);
        res.json({ success: true, message: `${foodServiceIds.length} food items added to your active menu successfully!` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.4 DESELECT MEAL FROM MENU (Mark Unavailable) ---
const deselectFoodItem = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodServiceId } = req.params;

        const mapping = await VendorFoodItem.findOneAndUpdate(
            { vendorId, foodServiceId },
            { $set: { isAvailable: false } },
            { new: true }
        );

        res.json({ success: true, message: "Item marked as Unavailable on your active menu.", data: mapping });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.5 GET USER SIDE MENU ---
const getVendorMenuForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorFoodItem.find({ vendorId }).lean();

        const finalMappedMenu = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            let UnavailableFoodItem = true;
            let finalPrice = meal.price;
            let finalDiscountPrice = meal.discountPrice;

            if (mapping && mapping.isAvailable === true) {
                UnavailableFoodItem = false;
                if (mapping.price !== null) finalPrice = mapping.price;
                if (mapping.discountPrice !== null) finalDiscountPrice = mapping.discountPrice;
            }

            return {
                ...meal,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                UnavailableFoodItem
            };
        });

        res.json({ success: true, vendorId, count: finalMappedMenu.length, data: finalMappedMenu });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🍱 2. COMBO OFFERS INVENTORY CRUD SECTION (🚨 UPDATED TO isAvailable)
// ==========================================

// --- 2.1 GET MASTER COMBOS CHECKLIST ---
const getMasterCombosForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;

        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        const vendorMappings = await VendorFoodCombo.find({ vendorId }).lean();

        const checklist = masterCombos.map(combo => {
            const mapping = vendorMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            return {
                ...combo,
                isAvailable: mapping ? mapping.isAvailable : false, // 👈 Pre-filled checkbox key
                customPrice: mapping ? mapping.price : null
            };
        });

        res.json({ success: true, count: checklist.length, data: checklist });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.2 GET SINGLE COMBO DETAIL BY ID ---
const getVendorComboById = async (req, res) => {
    try {
        const { id } = req.params; // foodComboId from URL
        const vendorId = req.user.id;

        const combo = await FoodComboOffer.findById(id)
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        if (!combo) {
            return res.status(404).json({ success: false, message: "Master combo offer not found." });
        }

        const mapping = await VendorFoodCombo.findOne({ vendorId, foodComboId: id }).lean();

        res.json({
            success: true,
            data: {
                ...combo,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.price : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.3 SELECT/ADD COMBOS TO KITCHEN MENU ---
const selectFoodCombos = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodComboIds } = req.body;

        if (!foodComboIds || !Array.isArray(foodComboIds)) {
            return res.status(400).json({ success: false, message: "foodComboIds array is required." });
        }

        const operations = foodComboIds.map(id => ({
            updateOne: {
                filter: { vendorId, foodComboId: id },
                update: { $set: { isAvailable: true } }, // 👈 Updated to isAvailable
                upsert: true
            }
        }));

        await VendorFoodCombo.bulkWrite(operations);
        res.json({ success: true, message: `${foodComboIds.length} Combo packages successfully added to your active menu!` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.4 DESELECT / REMOVE COMBO FROM KITCHEN MENU (Mark Unavailable) ---
const deselectFoodCombo = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodComboId } = req.params;

        const mapping = await VendorFoodCombo.findOneAndUpdate(
            { vendorId, foodComboId },
            { $set: { isAvailable: false } }, // 👈 Updated to isAvailable
            { new: true }
        );

        res.json({ success: true, message: "Combo package removed from your active menu.", data: mapping });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.5 GET USER SIDE COMBOS ---
const getVendorCombosForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        const vendorComboMappings = await VendorFoodCombo.find({ vendorId }).lean();

        const finalMappedCombos = masterCombos.map(combo => {
            const mapping = vendorComboMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            let UnavailableCombo = true;
            let finalPrice = combo.comboPrice;

            if (mapping && mapping.isAvailable === true) {
                UnavailableCombo = false;
                if (mapping.price !== null) finalPrice = mapping.price;
            }

            return {
                ...combo,
                comboPrice: finalPrice,
                UnavailableCombo
            };
        });

        res.json({ success: true, vendorId, count: finalMappedCombos.length, data: finalMappedCombos });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    selectFoodItems,
    deselectFoodItem,
    getVendorMenuItemById,
    getMasterCatalogForSelection,
    getVendorMenuForUser,

    // New Combo Exports
    getMasterCombosForSelection,
    getVendorComboById, // 👈 New single detail export
    selectFoodCombos,
    deselectFoodCombo,
    getVendorCombosForUser
};