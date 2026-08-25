const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { updateSelectedPatients,addToLabCart, getMyCart, clearLabCart, removeItem, updateCartQuantity,
    compareCartOnMap,
    addToPharmacyCart,
    updatePharmacyQuantity,checkBetterOptions,
    clearPharmacyCart, removePharmacyItem,
updateMedicineDuration,
   getLabCart, getPharmacyCart,
    getAvailableSlots,
    getAvailableCoupons,
    addToFoodCart,
    updateFoodCartQuantity,
    removeFoodCartItem,
    clearFoodCart,
    getFoodCart

 } = require('../../../controllers/user/Lab/Cart');

// Base URL Endpoint: /user/cart

router.get('/', protect('user'), getMyCart);  //  Get User's Cart (Lab + Pharmacy)  8
router.get('/lab', protect('user'), getLabCart); // GET Lab Cart
router.post('/lab/add', protect('user'), addToLabCart);
router.post('/lab/clear', protect('user'), clearLabCart);
router.post('/lab/select-patients', protect('user'), updateSelectedPatients);
router.delete('/item/:itemId', protect('user'), removeItem);// lab cart item removal by itemId (could be test or package)
router.put('/quantity', protect('user'), updateCartQuantity);

router.post('/compare', protect('user'), compareCartOnMap);


// pharmcacy
// Pharmacy Cart Endpoints
router.get('/pharmacy', protect('user'), getPharmacyCart); // GET Pharmacy Cart
router.post('/pharmacy/add', protect('user'), addToPharmacyCart); 
router.put('/pharmacy/quantity', protect('user'), updatePharmacyQuantity);
router.post('/pharmacy/clear', protect('user'), clearPharmacyCart);
router.delete('/pharmacy/item/:medicineId', protect('user'), removePharmacyItem);


// ==========================================
//  3. FOOD / TIFFIN CART ENDPOINTS 
// ==========================================

// 1. Get Single Food Cart details (Public or User-end)
// Full Path: GET /user/cart/food
router.get('/food', protect('user'), getFoodCart);

// 2. Add Item to Kitchen Cart (Bypasses price tampering, dynamic subscription end dates)
// Full Path: POST /user/cart/food/add
router.post('/food/add', protect('user'), addToFoodCart);

// 3. Update Meal/Combo Quantity
// Full Path: PUT /user/cart/food/quantity
router.put('/food/quantity', protect('user'), updateFoodCartQuantity);

// 4. Remove Single Item (Supports both Meal and BOGO/Combo objects)
// Full Path: DELETE /user/cart/food/item/:itemId
router.delete('/food/item/:itemId', protect('user'), removeFoodCartItem);

// 5. Clear Full Food Cart
// Full Path: POST /user/cart/food/clear
router.post('/food/clear', protect('user'), clearFoodCart);


router.post('/check-better-options', protect('user'), checkBetterOptions);
router.put('/update-duration', protect('user'), updateMedicineDuration);

router.get('/available-slots', protect('user'), getAvailableSlots);
router.get('/available-coupons', protect('user'), getAvailableCoupons);

module.exports = router; 