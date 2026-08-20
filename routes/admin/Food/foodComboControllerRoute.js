// routes/admin/Food/FoodManageRoute.js

const express = require('express');
const router = express.Router();

const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');



const {
    createComboOffer,
    getComboOffers,
    getComboOfferById,
    updateComboOffer,
    deleteComboOffer,
    toggleComboAvailability
} = require('../../../controllers/admin/Food/foodComboController');

// Base URL: /admin/food/manage/combo

// ==========================================
//  FOOD COMBO OFFERS CRUD SECTION
// ==========================================

// 1. Create a discounted combo package
// Full Path: POST /admin/food/manage/combo/add
router.post('/add', protect('admin'), checkRoleAccess(36), createComboOffer);

// 2. Update combo details (prices / selected meals list / quantities)
// Full Path: PUT /admin/food/manage/combo/update/:id
router.put('/update/:id', protect('admin'), checkRoleAccess(36), updateComboOffer);

// 3. Remove/Delete combo package
// Full Path: DELETE /admin/food/manage/combo/delete/:id
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteComboOffer);

// 4. Toggle active status switch ( Fimga Switch Trigger )
// Full Path: PATCH /admin/food/manage/combo/toggle-status/:id
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleComboAvailability);

// 5. Get all combos list (optional query: ?activeOnly=true)
// Full Path: GET /admin/food/manage/combo/get
router.get('/get', getComboOffers);

// 6. Get single combo detailed parameters
// Full Path: GET /admin/food/manage/combo/get/:id
router.get('/get/:id', getComboOfferById);

module.exports = router;