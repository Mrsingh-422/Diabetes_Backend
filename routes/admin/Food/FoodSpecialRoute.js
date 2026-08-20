// routes/admin/Food/FoodSpecialRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

const {
    getTodaySpecials,
    publishTodaySpecials,
    removeTodaySpecial,
    getWeeklyTemplateMenu,
    updateDayMenuTemplate
} = require('../../../controllers/admin/Food/FoodSpecial');

// Base URL: /admin/food/special

// --- TODAY'S SPECIALS APIS ---
router.get('/today', getTodaySpecials); // Public / Admin list load
router.post('/today/publish', protect('admin'), checkRoleAccess(36), publishTodaySpecials); // Close & Publish Specials Button
router.delete('/today/delete/:id', protect('admin'), checkRoleAccess(36), removeTodaySpecial); // Remove Special Button

// --- WEEKLY PLANNERS APIS ---
router.get('/weekly', getWeeklyTemplateMenu); // Dashboard Planner list load
router.put('/weekly/update/:day', protect('admin'), checkRoleAccess(36), updateDayMenuTemplate); // Edit Day Menu Save Button

module.exports = router;