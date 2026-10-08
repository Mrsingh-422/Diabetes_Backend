// controllers/user/CGMDevices/UserCGMDeviceController.js

const CGMDevices = require('../../../models/CGMDevicesModel');
const DeviceCategory = require('../../../models/DeviceCategory');
const CGMAddon = require('../../../models/CGMAddon');

const mongoose = require('mongoose');

// =========================================================================
// 🛒 1. GET ALL STOREFRONT PRODUCTS (LIGHTWEIGHT CARDS)
// Endpoint: GET /user/cgm/devices/get
// =========================================================================
const getUserCGMDevices = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            search = "", 
            categoryId, 
            productType, 
            isPopular, 
            isFeatured,
            sortBy = "newest" 
        } = req.query;

        const query = { 
            isActive: true, 
            isAvailable: true 
        };

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            query.categoryId = categoryId;
        }

        if (productType && ['Glucometer', 'CGM'].includes(productType)) {
            query.productType = productType;
        }

        if (isPopular === 'true') query.isPopular = true;
        if (isFeatured === 'true') query.isFeatured = true;

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { title: regex },
                { brand: regex },
                { deviceModel: regex }
            ];
        }

        let sortOptions = { createdAt: -1 };
        if (sortBy === 'price_low_high') sortOptions = { sellingPrice: 1 };
        if (sortBy === 'price_high_low') sortOptions = { sellingPrice: -1 };
        if (sortBy === 'popular') sortOptions = { averageRating: -1, totalReviews: -1 };

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await CGMDevices.countDocuments(query);

        // 🎯 Fast lightweight card projection (Without heavy faqs/steps arrays)
        const devices = await CGMDevices.find(query)
            .select('_id categoryId productType title brand deviceModel tagline badge mainImage mrp sellingPrice savingsAmount stockQuantity averageRating totalReviews totalUsersCountDisplay isPopular isFeatured createdAt')
            .populate('categoryId', 'name')
            .sort(sortOptions)
            .skip(skip)
            .limit(limitNum)
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: devices.length,
            data: devices
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 2. GET SINGLE PRODUCT DETAILS (FULL COMPLETE VIEW)
// Endpoint: GET /user/cgm/devices/get/:id
// =========================================================================
const getUserCGMDeviceById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Device ID format." });
        }

        const device = await CGMDevices.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'name ')
            .populate({
                path: 'frequentlyBoughtTogether.productId',
                select: 'title brand mainImage sellingPrice mrp productType'
            })
            .lean();

        if (!device) {
            return res.status(404).json({ success: false, message: "Product not found or is currently unavailable." });
        }

        res.json({
            success: true,
            data: device
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🏷️ 3. GET ACTIVE CATEGORIES FOR STORE TABS
// Endpoint: GET /user/cgm/devices/categories
// =========================================================================
const getUserActiveCategories = async (req, res) => {
    try {
        const categories = await DeviceCategory.find({ isActive: true })
            .select('_id name description')
            .sort({ createdAt: 1 })
            .lean();

        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🧩 4. GET ACTIVE CGM ADDONS FOR USER CHECKOUT SCREEN
// Endpoint: GET /user/cgm/devices/addons
// =========================================================================
const getUserCGMAddons = async (req, res) => {
    try {
        const addons = await CGMAddon.find({ isActive: true, coachCharge: 0 })
            .select('_id name price description imageUrl')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            count: addons.length,
            data: addons
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getUserCGMDevices,
    getUserCGMDeviceById,
    getUserActiveCategories,
    getUserCGMAddons,
    
};