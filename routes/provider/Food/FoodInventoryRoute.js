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
// 🍔 1. MEALS INVENTORY CONTROL
// ==========================================
router.get('/master-catalog', protect('provider'), getMasterCatalogForSelection);
router.get('/:foodServiceId', protect('provider'), getVendorMenuItemById); // GET single meal details
router.post('/select', protect('provider'), selectFoodItems);
router.put('/deselect/:foodServiceId', protect('provider'), deselectFoodItem);

// ==========================================
// 🍱 2. COMBOS INVENTORY CONTROL
// ==========================================
router.get('/master-combos', protect('provider'), getMasterCombosForSelection);
router.get('/combo/:foodComboId', protect('provider'), getVendorComboById); // GET single combo details
router.post('/select-combos', protect('provider'), selectFoodCombos);
router.put('/deselect-combo/:foodComboId', protect('provider'), deselectFoodCombo);

module.exports = router;