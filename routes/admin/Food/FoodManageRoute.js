// routes/admin/Food/FoodManageRoute.js

const express = require('express');
const router = express.Router();

const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

// 🚨 Mapped both uploaders directly from centralized middleware
const { 
    foodServiceImageUpload, 
    bannerUploadParser 
} = require('../../../middleware/multer'); 

// Import controllers
const {
    createFoodItem,
    getFoodItems,
    getFoodItemById,
    updateFoodItem,
    deleteFoodItem,
    toggleFoodAvailability,
    
    // Banner controllers
    createHeroBanner,
    getHeroBanners,
    getHeroBannerById,
    updateHeroBanner,
    deleteHeroBanner,
    toggleBannerStatus
} = require('../../../controllers/admin/Food/FoodManage');

// Base URL: /admin/food/manage

// ==========================================
// 🍔 1. FOOD SERVICES CRUD SECTION
// ==========================================
router.post('/add', protect('admin'), checkRoleAccess(36), foodServiceImageUpload, createFoodItem);
router.put('/update/:id', protect('admin'), checkRoleAccess(36), foodServiceImageUpload, updateFoodItem);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(36), deleteFoodItem);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleFoodAvailability);
router.get('/get', getFoodItems);
router.get('/get/:id', getFoodItemById);

// ==========================================
// 📺 2. HERO BANNERS CRUD SECTION
// ==========================================

// 1. Create a dynamic hero banner (handles files upload up to 20MB)
// Full Path: POST /admin/food/manage/banner/add
router.post('/banner/add', protect('admin'), checkRoleAccess(36), bannerUploadParser, createHeroBanner);

// 2. Update existing banner details (optional image/video replacement)
// Full Path: PUT /admin/food/manage/banner/update/:id
router.put('/banner/update/:id', protect('admin'), checkRoleAccess(36), bannerUploadParser, updateHeroBanner);

// 3. Remove/Delete banner configuration
// Full Path: DELETE /admin/food/manage/banner/delete/:id
router.delete('/banner/delete/:id', protect('admin'), checkRoleAccess(36), deleteHeroBanner);

// 4. Toggle active visibility status switch
// Full Path: PATCH /admin/food/manage/banner/toggle-status/:id
router.patch('/banner/toggle-status/:id', protect('admin'), checkRoleAccess(36), toggleBannerStatus);

// 5. Get all banners list (optional: ?activeOnly=true)
// Full Path: GET /admin/food/manage/banner/get
router.get('/banner/get', getHeroBanners);

// 6. Get single banner detailed parameters
// Full Path: GET /admin/food/manage/banner/get/:id
router.get('/banner/get/:id', getHeroBannerById);

module.exports = router;