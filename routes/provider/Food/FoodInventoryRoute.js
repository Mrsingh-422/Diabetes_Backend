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
    deselectFoodCombo
} = require('../../../controllers/provider/Food/FoodInventoryController');

// Base URL context: /provider/food/inventory

// ==========================================
// 🚨 STEP 1: STATIC ROUTES KO HUMESHA SABSE UPAR RAKHEIN
// ==========================================

// A. Get Master Checklist for Meals
router.get('/master-catalog', protect('provider'), getMasterCatalogForSelection);

// B. Get Master Checklist for Combos (Ab yeh bina kisi conflict ke match hoga!)
router.get('/master-combos', protect('provider'), getMasterCombosForSelection);


// ==========================================
// 🚨 STEP 2: DYNAMIC ROUTES (WILDCARDS) KO SABSE NEECHE RAKHEIN
// ==========================================

// GET single meal details by ID
router.get('/:foodServiceId', protect('provider'), getVendorMenuItemById);

// GET single combo details by ID
router.get('/combo/:foodComboId', protect('provider'), getVendorComboById);


// ==========================================
// ⚙️ STEP 3: WRITE OPERATIONS
// ==========================================
router.post('/select', protect('provider'), selectFoodItems);
router.put('/deselect/:foodServiceId', protect('provider'), deselectFoodItem);
router.post('/select-combos', protect('provider'), selectFoodCombos);
router.put('/deselect-combo/:foodComboId', protect('provider'), deselectFoodCombo);

module.exports = router;