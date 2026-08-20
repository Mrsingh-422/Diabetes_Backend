// controllers/provider/Food/FoodInventoryController.js

const VendorFoodItem = require('../../../models/VendorFoodItem');
const FoodService = require('../../../models/FoodService');
const VendorFoodCombo = require('../../../models/VendorFoodCombo'); 
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
// 🔴 VENDOR PANEL: INVENTORY MANAGEMENT CRUD
// ==========================================

// --- 1. SELECT/ADD FOOD ITEMS TO KITCHEN INVENTORY ---
const selectFoodItems = async (req, res) => {
    try {
        const vendorId = req.user.id; // From protect('provider') middleware
        const { foodServiceIds } = req.body; // Array of master food IDs selected by vendor

        if (!foodServiceIds || !Array.isArray(foodServiceIds)) {
            return res.status(400).json({ success: false, message: "foodServiceIds array is required." });
        }

        const operations = foodServiceIds.map(id => ({
            updateOne: {
                filter: { vendorId, foodServiceId: id },
                update: { $set: { isSelected: true, isOutOfStock: false } },
                upsert: true // Creates if not exists, updates if exists
            }
        }));

        await VendorFoodItem.bulkWrite(operations);

        res.json({
            success: true,
            message: `${foodServiceIds.length} food items added to your active menu successfully!`
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. DESELECT / REMOVE ITEM FROM MENU (Mark Unavailable) ---
const deselectFoodItem = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodServiceId } = req.params;

        const mapping = await VendorFoodItem.findOneAndUpdate(
            { vendorId, foodServiceId },
            { $set: { isSelected: false } },
            { new: true }
        );

        res.json({
            success: true,
            message: "Item removed from your active menu and marked as Unavailable.",
            data: mapping
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. TOGGLE OUT OF STOCK STATUS (Temporarily Out Of Stock) ---
const toggleOutOfStock = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodServiceId } = req.params;

        const mapping = await VendorFoodItem.findOne({ vendorId, foodServiceId });
        if (!mapping) {
            return res.status(404).json({ success: false, message: "This item is not selected in your menu." });
        }

        mapping.isOutOfStock = !mapping.isOutOfStock;
        await mapping.save();

        res.json({
            success: true,
            message: `Item status updated to ${mapping.isOutOfStock ? 'Out of Stock' : 'In Stock'}`,
            isOutOfStock: mapping.isOutOfStock,
            data: mapping
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🟢 USER-END: DYNAMIC VENDOR MENU FETCH API
// ==========================================

// --- 4. GET VENDOR MENU CARD WITH UNAVAILABLE FLAGS INJECTED ---
// Full Path: GET /api/foodpage/vendor-menu/:vendorId
const getVendorMenuForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        // A. Fetch all active master food items
        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        // B. Fetch this specific vendor's inventory mappings
        const vendorMappings = await VendorFoodItem.find({ vendorId })
            .lean();

        // C. Dynamic Mapping: Match master meals with vendor selections
        const finalMappedMenu = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            let UnavailableFoodItem = true; // Default fallback to true (Unavailable) [cite: custom_context]
            let finalPrice = meal.price;
            let finalDiscountPrice = meal.discountPrice;

            // Strict evaluation checks:
            if (mapping && mapping.isSelected === true && mapping.isOutOfStock === false) {
                UnavailableFoodItem = false; // Item is selected and in-stock! [cite: custom_context]
                
                // Use custom pricing if overridden by vendor, else fallback to master prices
                if (mapping.price !== null) finalPrice = mapping.price;
                if (mapping.discountPrice !== null) finalDiscountPrice = mapping.discountPrice;
            }

            return {
                ...meal,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                UnavailableFoodItem, // 👈 Directly injected Boolean key for frontend [cite: custom_context]
                isOutOfStock: mapping ? mapping.isOutOfStock : false
            };
        });

        res.json({
            success: true,
            vendorId,
            count: finalMappedMenu.length,
            data: finalMappedMenu
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. GET MASTER CATALOG FOR VENDOR SELECTION (Figma Pre-filled Checklist) ---
// Full Path: GET /provider/food/inventory/master-catalog
const getMasterCatalogForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id; // From protect('food') middleware

        // A. Fetch all active master meals created by Admin
        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        // B. Fetch this specific vendor's current inventory mapping
        const vendorMappings = await VendorFoodItem.find({ vendorId }).lean();

        // C. Dynamic checkmark generator: Maps whether the item is already selected or not
        const selectionChecklist = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            return {
                ...meal,
                alreadySelected: mapping ? mapping.isSelected : false, // 👈 Frontend is key ke base par box ko pre-check (tick) karega
                isOutOfStock: mapping ? mapping.isOutOfStock : false,
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


// ==========================================
// 🍱 2. COMBO OFFERS INVENTORY CRUD SECTION (🚨 NEWLY ADDED)
// ==========================================

// --- 6. GET MASTER COMBOS CHECKLIST FOR VENDOR SELECTION ---
const getMasterCombosForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;

        // A. Fetch all active admin combos
        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        // B. Fetch this vendor's combo mapping record
        const vendorMappings = await VendorFoodCombo.find({ vendorId }).lean();

        // C. Generate dynamic checkmark states
        const checklist = masterCombos.map(combo => {
            const mapping = vendorMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            return {
                ...combo,
                alreadySelected: mapping ? mapping.isSelected : false, // 👈 For frontend checkbox dynamic ticks [cite: custom_context]
                isOutOfStock: mapping ? mapping.isOutOfStock : false,
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

// --- 7. SELECT/ADD COMBOS TO KITCHEN MENU ---
const selectFoodCombos = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodComboIds } = req.body; // Array of combo IDs selected by vendor [cite: custom_context]

        if (!foodComboIds || !Array.isArray(foodComboIds)) {
            return res.status(400).json({ success: false, message: "foodComboIds array is required." });
        }

        const operations = foodComboIds.map(id => ({
            updateOne: {
                filter: { vendorId, foodComboId: id },
                update: { $set: { isSelected: true, isOutOfStock: false } },
                upsert: true
            }
        }));

        await VendorFoodCombo.bulkWrite(operations);

        res.json({
            success: true,
            message: `${foodComboIds.length} Combo packages successfully added to your active menu!`
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 8. DESELECT / REMOVE COMBO FROM KITCHEN MENU (Mark Unavailable) ---
const deselectFoodCombo = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodComboId } = req.params;

        const mapping = await VendorFoodCombo.findOneAndUpdate(
            { vendorId, foodComboId },
            { $set: { isSelected: false } },
            { new: true }
        );

        res.json({
            success: true,
            message: "Combo package removed from your menu and marked as Unavailable.",
            data: mapping
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 9. TOGGLE OUT OF STOCK STATUS FOR COMBO ---
const toggleComboOutOfStock = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { foodComboId } = req.params;

        const mapping = await VendorFoodCombo.findOne({ vendorId, foodComboId });
        if (!mapping) {
            return res.status(404).json({ success: false, message: "This combo package is not active in your menu." });
        }

        mapping.isOutOfStock = !mapping.isOutOfStock;
        await mapping.save();

        res.json({
            success: true,
            message: `Combo status updated to ${mapping.isOutOfStock ? 'Out of Stock' : 'In Stock'}`,
            isOutOfStock: mapping.isOutOfStock,
            data: mapping
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 10. GET VENDOR COMBOS LIST WITH UNAVAILABLE FLAGS INJECTED (User-End API) ---
// Full Path: GET /api/foodpage/vendor-combos/:vendorId
const getVendorCombosForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        // A. Fetch all active master combo boxes
        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        // B. Fetch this specific vendor's combo mapping record
        const vendorComboMappings = await VendorFoodCombo.find({ vendorId }).lean();

        // C. Match and inject dynamic unavailability flags
        const finalMappedCombos = masterCombos.map(combo => {
            const mapping = vendorComboMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            let UnavailableCombo = true; // Default fallback to true (Unavailable) [cite: custom_context]
            let finalPrice = combo.comboPrice;

            if (mapping && mapping.isSelected === true && mapping.isOutOfStock === false) {
                UnavailableCombo = false; // Combo is active & in-stock! [cite: custom_context]
                if (mapping.price !== null) finalPrice = mapping.price; // Dynamic custom pricing override
            }

            return {
                ...combo,
                comboPrice: finalPrice,
                UnavailableCombo, // 👈 Directly injected Boolean key for frontend [cite: custom_context]
                isOutOfStock: mapping ? mapping.isOutOfStock : false
            };
        });

        res.json({
            success: true,
            vendorId,
            count: finalMappedCombos.length,
            data: finalMappedCombos
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    selectFoodItems,
    deselectFoodItem,
    toggleOutOfStock,
    getVendorMenuForUser,
    getMasterCatalogForSelection,

    getMasterCombosForSelection,
    selectFoodCombos,
    deselectFoodCombo,
    toggleComboOutOfStock,
    getVendorCombosForUser
};