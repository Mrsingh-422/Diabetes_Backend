// controllers/provider/Food/FoodInventoryController.js

const VendorFoodItem = require('../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../models/VendorFoodCombo');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const Food = require('../../../models/Food');
const TiffinPlan = require('../../../models/TiffinPlan');
const VendorTiffinPlan = require('../../../models/VendorTiffinPlan');
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

// --- 1.1 GET MASTER CATALOG FOR VENDOR SELECTION ---
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
                isAvailable: mapping ? mapping.isAvailable : false,
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
        const { id } = req.params;
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

// --- 1.4 DESELECT MEAL FROM MENU ---
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
// 🍱 2. COMBO OFFERS INVENTORY SECTION
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
                isAvailable: mapping ? mapping.isAvailable : false,
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
        const { id } = req.params;
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

// --- 2.4 DESELECT COMBO FROM KITCHEN MENU ---
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

// --- 3.1 TOGGLE VENDOR LIVE STATUS (ONLINE / OFFLINE) ---
const toggleVendorOnlineStatus = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { isOnline } = req.body;

        const vendor = await Food.findById(vendorId);
        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor profile not found." });
        }

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


// ==========================================
// 📅 4. TIFFIN PLANS INVENTORY SECTION (🚨 UPGRADED)
// ==========================================

// --- 4.1 GET MASTER TIFFIN PLANS CHECKLIST (With Slot-Wise Populated Dishes) ---
// Full Path: GET /provider/food/inventory/master-plans
const getMasterPlansForSelection = async (req, res) => {
    try {
        const vendorId = req.user.id;

        // A. Fetch all active Admin-created subscription plans with deep slot population
        const masterPlans = await TiffinPlan.find({ isActive: true })
            .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
            .lean();

        // B. Fetch this vendor's plan mappings
        const vendorPlanMappings = await VendorTiffinPlan.find({ vendorId }).lean();

        // C. Map isAvailable status on-the-fly
        const checklist = masterPlans.map(plan => {
            const mapping = vendorPlanMappings.find(
                map => map.planId.toString() === plan._id.toString()
            );

            return {
                ...plan,
                isAvailable: mapping ? mapping.isAvailable : false, // Checkbox checked if true
                customPrice: mapping ? mapping.customPrice : null
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

// --- 4.2 🌟 UNIFIED SYNC TIFFIN PLANS SELECTION (Single API for Multi-select) ---
// Selected IDs -> isAvailable: true | Unselected IDs -> isAvailable: false
// Full Path: POST /provider/food/inventory/sync-plans
const syncTiffinPlans = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { selectedPlanIds = [], customPricing = {} } = req.body; 

        if (!Array.isArray(selectedPlanIds)) {
            return res.status(400).json({ success: false, message: "selectedPlanIds must be an array of Plan IDs." });
        }

        // 1. Fetch all active master plans
        const allMasterPlans = await TiffinPlan.find({ isActive: true }).select('_id').lean();

        // 2. Build bulkWrite operations for ALL plans
        const operations = allMasterPlans.map(plan => {
            const planIdStr = plan._id.toString();
            const isSelected = selectedPlanIds.map(id => id.toString()).includes(planIdStr);
            const customPrice = customPricing[planIdStr] !== undefined ? Number(customPricing[planIdStr]) : null;

            const updatePayload = { isAvailable: isSelected };
            if (customPrice !== null) {
                updatePayload.customPrice = customPrice;
            }

            return {
                updateOne: {
                    filter: { vendorId, planId: plan._id },
                    update: { $set: updatePayload },
                    upsert: true
                }
            };
        });

        if (operations.length > 0) {
            await VendorTiffinPlan.bulkWrite(operations);
        }

        res.json({
            success: true,
            message: `Tiffin plans menu synchronized successfully! (${selectedPlanIds.length} Active Plans)`,
            activePlansCount: selectedPlanIds.length
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4.3 ⚡ SINGLE INSTANT TOGGLE SWITCH (One-Click Availability Toggle) ---
// Full Path: PATCH /provider/food/inventory/toggle-plan/:planId
const toggleTiffinPlanAvailability = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { planId } = req.params;

        const existing = await VendorTiffinPlan.findOne({ vendorId, planId });
        const newStatus = existing ? !existing.isAvailable : true;

        const mapping = await VendorTiffinPlan.findOneAndUpdate(
            { vendorId, planId },
            { $set: { isAvailable: newStatus } },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: `Tiffin plan status updated to ${newStatus ? 'Active' : 'Inactive'} successfully.`,
            isAvailable: newStatus,
            data: mapping
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📅 1. GET ALL VENDOR TIFFIN PLANS (Vendor Inventory List)
// Full Path: GET /provider/food/inventory/plans
// ==========================================
const getVendorTiffinPlans = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { isAvailable } = req.query; // Optional filter (?isAvailable=true)

        // 1. Fetch all active master plans with populated slot dishes
        const masterPlans = await TiffinPlan.find({ isActive: true })
            .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
            .lean();

        // 2. Fetch logged-in vendor's mappings
        const vendorPlanMappings = await VendorTiffinPlan.find({ vendorId }).lean();

        // 3. Map vendor status on-the-fly
        let result = masterPlans.map(plan => {
            const mapping = vendorPlanMappings.find(
                map => map.planId.toString() === plan._id.toString()
            );

            return {
                ...plan,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.customPrice : null
            };
        });

        // Optional query filter
        if (isAvailable !== undefined) {
            const statusBool = isAvailable === 'true';
            result = result.filter(p => p.isAvailable === statusBool);
        }

        // Sort: isAvailable: true first, then latest created
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
// 📅 2. GET SINGLE VENDOR TIFFIN PLAN FULL DETAILS BY ID
// Full Path: GET /provider/food/inventory/plans/:id
// ==========================================
const getVendorTiffinPlanById = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorId = req.user.id;

        // 1. Fetch master plan by _id or planId with deep clinical & ingredient details
        const plan = await TiffinPlan.findOne({
            $or: [{ _id: id }, { planId: id }],
            isActive: true
        })
        .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
        .lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Tiffin subscription plan not found." });
        }

        // 2. Fetch logged-in vendor's specific mapping
        const mapping = await VendorTiffinPlan.findOne({ 
            vendorId, 
            planId: plan._id 
        }).lean();

        res.json({
            success: true,
            data: {
                ...plan,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.customPrice : null
            }
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
    toggleVendorOnlineStatus,

    // Tiffin Plans Exports
    getMasterPlansForSelection,
    syncTiffinPlans,               //  Unified Single Sync API
    toggleTiffinPlanAvailability,  //  Instant Single Switch API
    getVendorTiffinPlans,          //  Vendor Inventory List
    getVendorTiffinPlanById        //  Single Plan Full Details

    
};