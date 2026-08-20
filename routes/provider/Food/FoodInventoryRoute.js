// routes/provider/Food/FoodInventoryRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    selectFoodItems,
    deselectFoodItem,
    toggleOutOfStock,
    getMasterCatalogForSelection,
    
    // 🚨 NEW IMPORTS ADDED:
    getMasterCombosForSelection,
    selectFoodCombos,
    deselectFoodCombo,
    toggleComboOutOfStock
} = require('../../../controllers/provider/Food/FoodInventoryController');

// Base URL context: /provider/food/inventory

// ==========================================
// 🍔 1. MEALS INVENTORY CONTROL
// ==========================================
router.get('/master-catalog', protect('provider'), getMasterCatalogForSelection);
router.post('/select', protect('provider'), selectFoodItems);
router.put('/deselect/:foodServiceId', protect('provider'), deselectFoodItem);
router.patch('/toggle-stock/:foodServiceId', protect('provider'), toggleOutOfStock);

// ==========================================
// 🍱 2. COMBOS INVENTORY CONTROL (🚨 NEWLY ADDED)
// ==========================================

// 1. Get master combos checklist (Figma select checks)
// Full Path: GET /provider/food/inventory/master-combos
router.get('/master-combos', protect('provider'), getMasterCombosForSelection);

// 2. Bulk select master combos to add to vendor menu
// Full Path: POST /provider/food/inventory/select-combos
router.post('/select-combos', protect('provider'), selectFoodCombos);

// 3. Remove combo from menu (Marks as Unavailable)
// Full Path: PUT /provider/food/inventory/deselect-combo/:foodComboId
router.put('/deselect-combo/:foodComboId', protect('provider'), deselectFoodCombo);

// 4. Toggle Out of Stock status for combo
// Full Path: PATCH /provider/food/inventory/toggle-stock-combo/:foodComboId
router.patch('/toggle-stock-combo/:foodComboId', protect('provider'), toggleComboOutOfStock);

module.exports = router;