// routes/provider/Food/FoodInventoryRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    selectFoodItems,
    deselectFoodItem,
    getVendorMenuItemById,
    getMasterCatalogForSelection,
    
    // Combo imports
    getMasterCombosForSelection,
    getVendorComboById,
    selectFoodCombos,
    deselectFoodCombo,
    toggleVendorOnlineStatus,

    // Tiffin Plans imports
    getMasterPlansForSelection,
    syncTiffinPlans,
    toggleTiffinPlanAvailability,

} = require('../../../controllers/provider/Food/FoodInventoryController');

// Base URL: /provider/food/inventory

// ==========================================
// 🚨 STEP 1: STATIC GET ROUTES (Always placed on top)
// ==========================================
router.get('/master-catalog', protect('provider'), getMasterCatalogForSelection);
router.get('/master-combos', protect('provider'), getMasterCombosForSelection);
router.get('/master-plans', protect('provider'), getMasterPlansForSelection);

// ==========================================
// ⚙️ STEP 2: WRITE / SYNC OPERATIONS
// ==========================================
// Meals & Combos
router.post('/select', protect('provider'), selectFoodItems);
router.put('/deselect/:foodServiceId', protect('provider'), deselectFoodItem);
router.post('/select-combos', protect('provider'), selectFoodCombos);
router.put('/deselect-combo/:foodComboId', protect('provider'), deselectFoodCombo);

// Vendor Live Online Toggle
router.patch('/toggle-online', protect('provider'), toggleVendorOnlineStatus);

// 🌟 TIFFIN PLANS: Unified Sync & Toggle Routes
router.post('/sync-plans', protect('provider'), syncTiffinPlans);
router.patch('/toggle-plan/:planId', protect('provider'), toggleTiffinPlanAvailability);



// ==========================================
// 🚨 STEP 3: DYNAMIC WILDCARD ROUTES (Always placed at the bottom)
// ==========================================
router.get('/:foodServiceId', protect('provider'), getVendorMenuItemById);
router.get('/combo/:foodComboId', protect('provider'), getVendorComboById);

module.exports = router;