// controllers/provider/Food/FoodInventoryController.js

const VendorFoodItem = require('../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../models/VendorFoodCombo');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const mongoose = require('mongoose');

// Helper to safely parse strings into arrays of strings
const parseStringToArray = (field) => {
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
        return field.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
};

// ==========================================
// 🍔 1. MEALS INVENTORY CRUD SECTION
// ==========================================

// --- 1.1 GET MASTER CATALOG FOR VENDOR SELECTION (Shows ALL admin items with available true/false) ---
// Full Path: GET /provider/food/inventory/master-catalog
const getMasterCatalogForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id; // From protect('provider') middleware

        // A. Fetch ALL active master meals created by Admin [cite: custom_context]
        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        // B. Fetch this specific vendor's current inventory mapping [cite: custom_context]
        const vendorMappings = await VendorFoodItem.find({ vendorId }).lean();

        // C. Dynamic checkmark generator: Maps isAvailable state on-the-fly [cite: custom_context]
        const selectionChecklist = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            return {
                ...meal,
                // 🚨 UPDATED KEY: Selected items will return true, non-selected/unmapped will return false
                isAvailable: mapping ? mapping.isAvailable : false, // [cite: custom_context]
                customPrice: mapping ? mapping.price : null,
                customDiscountPrice: mapping ? mapping.discountPrice : null
            };
        });

        res.json({
            success: true,
            count: selectionChecklist.length,
            data: selectionChecklist
        });

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

// --- 2.1 GET MASTER COMBOS CHECKLIST (Shows ALL admin combos with available true/false) ---
// Full Path: GET /provider/food/inventory/master-combos
const getMasterCombosForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;

        // A. Fetch ALL active admin combos [cite: custom_context]
        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        // B. Fetch this vendor's combo mapping record [cite: custom_context]
        const vendorMappings = await VendorFoodCombo.find({ vendorId }).lean();

        // C. Generate dynamic checkmark states: Maps isAvailable state on-the-fly [cite: custom_context]
        const checklist = masterCombos.map(combo => {
            const mapping = vendorMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            return {
                ...combo,
                // 🚨 UPDATED KEY: Selected combos will return true, non-selected will return false
                isAvailable: mapping ? mapping.isAvailable : false, // [cite: custom_context]
                customPrice: mapping ? mapping.price : null
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
                update: { $set: { isAvailable: true } },
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
            { $set: { isAvailable: false } },
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

// --- 1.1 TOGGLE VENDOR LIVE STATUS (ONLINE / OFFLINE) ---
// Full Path: PATCH /provider/food/inventory/toggle-online
const toggleVendorOnlineStatus = async (req, res) => {
    try {
        const vendorId = req.user.id; // From protect('provider') middleware
        const { isOnline } = req.body;

        const vendor = await Food.findById(vendorId);
        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor profile not found." });
        }

        // Body mein value aayi toh set karein, varna current status ka opposite toggle karein
        const newStatus = isOnline !== undefined ? Boolean(isOnline) : !vendor.isOnline;

        const updatedVendor = await Food.findByIdAndUpdate(
            vendorId,
            { $set: { isOnline: newStatus } },
            { new: true }
        ).select('-password -token -fcmToken');

        res.json({
            success: true,
            message: `Kitchen status updated to ${updatedVendor.isOnline ? 'Online' : 'Offline'} successfully.`,
            isOnline: updatedVendor.isOnline,
            data: updatedVendor
        });

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

    // Combo Exports
    getMasterCombosForSelection,
    getVendorComboById,
    selectFoodCombos,
    deselectFoodCombo,
    getVendorCombosForUser,
    toggleVendorOnlineStatus
};