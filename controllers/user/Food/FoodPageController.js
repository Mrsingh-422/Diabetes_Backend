// controllers/user/Food/FoodPageController.js

const FoodCategory = require('../../../models/FoodCategory');
const FoodService = require('../../../models/FoodService');
const TodaySpecial = require('../../../models/TodaySpecialFood');
const WeeklySpecial = require('../../../models/WeeklySpecialFood');
const VendorFoodItem = require('../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../models/VendorFoodCombo');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const Coupon = require('../../../models/Coupon');
const Food = require('../../../models/Food');
const VendorKMLimit = require('../../../models/VendorKMLimit');

// ==========================================
// 💡 PURE HAVERSINE MATHEMATICAL DISTANCE ENGINE
// ==========================================
const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers [37]
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in KM [37]
    return distance;
};

// ==========================================
// 🚨 NEW: POST NEAREST VENDORS ACTIVE FOOD ITEMS LIST (Zomato-style)
// ==========================================

// --- 5. GET NEAREST MEALS WITH IN-MEMORY PAGINATION (Default Limit: 20) ---
const getNearestVendorMeals = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        
        // 🚨 Capture query pagination params with default fallback of 20 limits
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude and longitude are required." });
        }

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10; 

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendorsMap = new Map();
        const nearestVendors = [];

        for (let vendor of vendors) {
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) {
                continue;
            }

            const distance = calculateHaversineDistance(
                Number(lat),
                Number(lng),
                Number(vendor.location.lat),
                Number(vendor.location.lng)
            );

            if (distance <= maxDistanceLimit) {
                const vendorData = {
                    ...vendor,
                    distance: Number(distance.toFixed(2)),
                    distanceText: `${distance.toFixed(1)} km`
                };
                nearestVendorsMap.set(vendor._id.toString(), vendorData);
                nearestVendors.push(vendorData);
            }
        }

        nearestVendors.sort((a, b) => a.distance - b.distance);
        const serviceableVendorIds = Array.from(nearestVendorsMap.keys());

        if (nearestVendors.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorFoodItem.find({
            vendorId: { $in: serviceableVendorIds }
        }).lean();

        const nearestMealsList = [];

        for (let meal of masterMeals) {
            const mealMappings = vendorMappings.filter(
                m => m.foodServiceId.toString() === meal._id.toString()
            );

            const activeMapping = mealMappings.find(m => m.isAvailable === true);

            let isAvailable = false;
            let finalPrice = meal.price;
            let finalDiscountPrice = meal.discountPrice;
            let targetVendor = nearestVendors[0];

            if (activeMapping) {
                isAvailable = true;
                targetVendor = nearestVendorsMap.get(activeMapping.vendorId.toString());
                if (activeMapping.price !== null) finalPrice = activeMapping.price;
                if (activeMapping.discountPrice !== null) finalDiscountPrice = activeMapping.discountPrice;
            } else {
                const anyMapping = mealMappings[0];
                if (anyMapping) {
                    targetVendor = nearestVendorsMap.get(anyMapping.vendorId.toString());
                }
            }

            nearestMealsList.push({
                _id: meal._id,
                name: meal.name,
                description: meal.description,
                imageUrl: meal.imageUrl,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                servingSize: meal.servingSize,
                dietType: meal.dietType,
                prepTime: meal.prepTime,
                calories: meal.calories,
                spicyLevel: meal.spicyLevel,
                ingredients: meal.ingredients,
                tags: meal.tags,
                glycemicIndex: meal.glycemicIndex,
                netCarbs: meal.netCarbs,
                foodEffectCategory: meal.foodEffectCategory,
                isAvailable,
                UnavailableFoodItem: !isAvailable,
                vendorId: {
                    _id: targetVendor._id,
                    name: targetVendor.name,
                    address: targetVendor.address,
                    rating: targetVendor.rating,
                    profileImage: targetVendor.profileImage
                },
                distance: targetVendor.distance,
                distanceText: targetVendor.distanceText
            });
        }

        nearestMealsList.sort((a, b) => a.distance - b.distance);

        // 🚨 IN-MEMORY PAGINATION MATHEMATICS
        const totalDocs = nearestMealsList.length;
        const skip = (page - 1) * limit;
        const paginatedMeals = nearestMealsList.slice(skip, skip + limit);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: page,
            limit,
            data: paginatedMeals // Returns exactly sliced array according to page parameter
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🔴 CORE LANDING PAGE APIS
// ==========================================

const getFoodPageLayout = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const categories = await FoodCategory.find().sort({ createdAt: -1 });

        const totalDocs = await TodaySpecial.countDocuments();
        const rawSpecials = await TodaySpecial.find()
            .populate({
                path: 'foodItemId',
                populate: { path: 'categoryId', select: 'foodCategory' }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const todaySpecials = rawSpecials
            .filter(s => s.foodItemId !== null)
            .map(s => s.foodItemId); 

        const popularMeals = await FoodService.find({ isPopular: true, isActive: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 });

        const recommendedMeals = await FoodService.find({ isRecommended: true, isActive: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: {
                categories,
                todaySpecials, 
                popularMeals,
                recommendedMeals,
                pagination: { 
                    totalDocs,
                    totalPages: Math.ceil(totalDocs / parseInt(limit)),
                    currentPage: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getTodaySpecialById = async (req, res) => {
    try {
        const { id } = req.params;
        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory');

        if (!meal) {
            return res.status(404).json({ success: false, message: "Today's special detail not found." });
        }

        res.json({ success: true, data: meal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUserWeeklyMenu = async (req, res) => {
    try {
        const weeklyMenu = await WeeklySpecial.find()
            .populate('meals', 'name price calories imageUrl dietType');

        const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        const calendarPlan = weekdays.map(day => {
            const foundDay = weeklyMenu.find(m => m.dayOfWeek === day);
            return {
                dayOfWeek: day,
                mealsCount: foundDay ? foundDay.meals.length : 0,
                meals: foundDay ? foundDay.meals : []
            };
        });

        res.json({
            success: true,
            data: calendarPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getWeeklySpecialById = async (req, res) => {
    try {
        const { id } = req.params;
        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory');

        if (!meal) {
            return res.status(404).json({ success: false, message: "Weekly plan tiffin details not found." });
        }

        res.json({ success: true, data: meal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚨 NEW: POST NEAREST GEOLOCATED COMBO OFFERS LIST
// ==========================================
// --- 6. GET NEAREST COMBOS WITH IN-MEMORY PAGINATION (Default Limit: 20) ---
const getNearestCombos = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        
        // 🚨 Capture query pagination params with default fallback of 20 limits
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude and longitude are required." });
        }

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10; 

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendors = [];
        const nearestVendorsMap = new Map();

        for (let vendor of vendors) {
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) {
                continue;
            }

            const distance = calculateHaversineDistance(
                Number(lat),
                Number(lng),
                Number(vendor.location.lat),
                Number(vendor.location.lng)
            );

            if (distance <= maxDistanceLimit) {
                const vendorData = {
                    ...vendor,
                    distance: Number(distance.toFixed(2)),
                    distanceText: `${distance.toFixed(1)} km`
                };
                nearestVendors.push(vendorData);
                nearestVendorsMap.set(vendor._id.toString(), vendorData);
            }
        }

        nearestVendors.sort((a, b) => a.distance - b.distance);
        const serviceableVendorIds = nearestVendors.map(v => v._id);

        if (nearestVendors.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        const vendorComboMappings = await VendorFoodCombo.find({
            vendorId: { $in: serviceableVendorIds }
        }).lean();

        const mappedCombosList = [];

        for (let combo of masterCombos) {
            const comboMappings = vendorComboMappings.filter(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            const activeMapping = comboMappings.find(m => m.isAvailable === true);

            let isAvailable = false;
            let finalPrice = combo.comboPrice;
            let targetVendor = nearestVendors[0]; 

            if (activeMapping) {
                isAvailable = true;
                targetVendor = nearestVendorsMap.get(activeMapping.vendorId.toString());
                if (activeMapping.price !== null) finalPrice = activeMapping.price;
            } else {
                const anyMapping = comboMappings[0];
                if (anyMapping) {
                    targetVendor = nearestVendorsMap.get(anyMapping.vendorId.toString());
                }
            }

            mappedCombosList.push({
                _id: combo._id,
                comboId: combo.comboId,
                name: combo.name,
                description: combo.description,
                basePrice: combo.basePrice,
                comboPrice: finalPrice, 
                spicyLevel: combo.spicyLevel,
                isPopular: combo.isPopular,
                isRecommended: combo.isRecommended,
                dishes: combo.dishes,
                isAvailable,
                UnavailableCombo: !isAvailable,
                vendorId: {
                    _id: targetVendor._id,
                    name: targetVendor.name,
                    address: targetVendor.address,
                    rating: targetVendor.rating,
                    profileImage: targetVendor.profileImage
                },
                distance: targetVendor.distance,
                distanceText: targetVendor.distanceText
            });
        }

        mappedCombosList.sort((a, b) => a.distance - b.distance);

        // 🚨 IN-MEMORY PAGINATION MATHEMATICS
        const totalDocs = mappedCombosList.length;
        const skip = (page - 1) * limit;
        const paginatedCombos = mappedCombosList.slice(skip, skip + limit);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: page,
            limit,
            data: paginatedCombos // Returns exactly sliced array according to page parameter
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚨 NEW USER GET BY ID APIS (Fires on Card click to load overlays)
// ==========================================

// --- 5. GET SINGLE MEAL DETAILS BY ID (With Dynamic Geolocated Proximity Mapping) ---
// Full Path: GET /api/foodpage/meals/:id?lat=xx&lng=yy
const getMealDetailsById = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query; // Captured optionally from query params [cite: custom_context]

        // 1. Fetch Master Meal specifications [cite: custom_context]
        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .select('-glycemicIndex -netCarbs -sodium -potassium -phosphorus')
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!meal) {
            return res.status(404).json({ success: false, message: "Meal item is currently unavailable." });
        }

        let targetVendor = null;
        let distance = null;
        let distanceText = null;
        let isAvailable = false;
        let finalPrice = meal.price;
        let finalDiscountPrice = meal.discountPrice;

        // 2. Fetch all approved active kitchens [cite: custom_context]
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location address rating profileImage')
            .lean();

        // 3. If Coordinates provided: Calculate Proximity & Fallback [37]
        if (lat && lng && vendors.length > 0) {
            const nearestVendorsMap = new Map();
            const nearestVendors = [];

            for (let vendor of vendors) {
                if (!vendor.location || !vendor.location.lat || !vendor.location.lng) continue;

                const computedDistance = calculateHaversineDistance(
                    Number(lat),
                    Number(lng),
                    Number(vendor.location.lat),
                    Number(vendor.location.lng)
                );

                const vendorData = {
                    ...vendor,
                    distance: Number(computedDistance.toFixed(2)),
                    distanceText: `${computedDistance.toFixed(1)} km`
                };
                nearestVendorsMap.set(vendor._id.toString(), vendorData);
                nearestVendors.push(vendorData);
            }

            nearestVendors.sort((a, b) => a.distance - b.distance);

            if (nearestVendors.length > 0) {
                const serviceableVendorIds = nearestVendors.map(v => v._id);

                // Find mappings for this dish among nearby vendors [cite: custom_context]
                const mappings = await VendorFoodItem.find({
                    foodServiceId: id,
                    vendorId: { $in: serviceableVendorIds }
                }).lean();

                const activeMapping = mappings.find(m => m.isAvailable === true);

                if (activeMapping) {
                    isAvailable = true;
                    const vInfo = nearestVendorsMap.get(activeMapping.vendorId.toString());
                    targetVendor = {
                        _id: vInfo._id,
                        name: vInfo.name,
                        address: vInfo.address,
                        rating: vInfo.rating,
                        profileImage: vInfo.profileImage
                    };
                    distance = vInfo.distance;
                    distanceText = vInfo.distanceText;
                    if (activeMapping.price !== null) finalPrice = activeMapping.price;
                    if (activeMapping.discountPrice !== null) finalDiscountPrice = activeMapping.discountPrice;
                } else {
                    // 🚨 EXACT SAME LOGIC AS NEARMEALS: Fallback to closest kitchen in range! [cite: custom_context]
                    const fallbackVendor = nearestVendors[0];
                    targetVendor = {
                        _id: fallbackVendor._id,
                        name: fallbackVendor.name,
                        address: fallbackVendor.address,
                        rating: fallbackVendor.rating,
                        profileImage: fallbackVendor.profileImage
                    };
                    distance = fallbackVendor.distance;
                    distanceText = fallbackVendor.distanceText;
                }
            }
        } else {
            // 4. Fallback if user coordinates are NOT provided: Pick first available kitchen mapping
            const anyMapping = await VendorFoodItem.findOne({ foodServiceId: id })
                .populate('vendorId', 'name address rating profileImage')
                .lean();

            if (anyMapping && anyMapping.vendorId) {
                targetVendor = anyMapping.vendorId;
                isAvailable = anyMapping.isAvailable;
            } else if (vendors.length > 0) {
                targetVendor = {
                    _id: vendors[0]._id,
                    name: vendors[0].name,
                    address: vendors[0].address,
                    rating: vendors[0].rating,
                    profileImage: vendors[0].profileImage
                };
            }
        }

        res.json({
            success: true,
            data: {
                ...meal,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                isAvailable,
                UnavailableFoodItem: !isAvailable,
                vendorId: targetVendor, // 👈 Never null now!
                distance,
                distanceText
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. GET SINGLE COMBO BUNDLE DETAILS BY ID (With Proximity Fallbacks) ---
// Full Path: GET /api/foodpage/combos/:id?lat=xx&lng=yy
const getComboDetailsById = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query;

        const combo = await FoodComboOffer.findOne({ _id: id, isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories ingredients tags glycemicIndex netCarbs sodium'
            })
            .lean();

        if (!combo) {
            return res.status(404).json({ success: false, message: "Combo offer tiffin bundle is currently unavailable." });
        }

        let targetVendor = null;
        let distance = null;
        let distanceText = null;
        let isAvailable = false;
        let finalPrice = combo.comboPrice;

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location address rating profileImage')
            .lean();

        if (lat && lng && vendors.length > 0) {
            const nearestVendors = [];
            const nearestVendorsMap = new Map();

            for (let vendor of vendors) {
                if (!vendor.location || !vendor.location.lat || !vendor.location.lng) continue;

                const computedDistance = calculateHaversineDistance(
                    Number(lat),
                    Number(lng),
                    Number(vendor.location.lat),
                    Number(vendor.location.lng)
                );

                const vData = {
                    ...vendor,
                    distance: Number(computedDistance.toFixed(2)),
                    distanceText: `${computedDistance.toFixed(1)} km`
                };
                nearestVendors.push(vData);
                nearestVendorsMap.set(vendor._id.toString(), vData);
            }

            nearestVendors.sort((a, b) => a.distance - b.distance);

            if (nearestVendors.length > 0) {
                const serviceableVendorIds = nearestVendors.map(v => v._id);

                const mappings = await VendorFoodCombo.find({
                    foodComboId: id,
                    vendorId: { $in: serviceableVendorIds }
                }).lean();

                const activeMapping = mappings.find(m => m.isAvailable === true);

                if (activeMapping) {
                    isAvailable = true;
                    const vInfo = nearestVendorsMap.get(activeMapping.vendorId.toString());
                    targetVendor = {
                        _id: vInfo._id,
                        name: vInfo.name,
                        address: vInfo.address,
                        rating: vInfo.rating,
                        profileImage: vInfo.profileImage
                    };
                    distance = vInfo.distance;
                    distanceText = vInfo.distanceText;
                    if (activeMapping.price !== null) finalPrice = activeMapping.price;
                } else {
                    // Fallback to closest kitchen in range [cite: custom_context]
                    const fallbackVendor = nearestVendors[0];
                    targetVendor = {
                        _id: fallbackVendor._id,
                        name: fallbackVendor.name,
                        address: fallbackVendor.address,
                        rating: fallbackVendor.rating,
                        profileImage: fallbackVendor.profileImage
                    };
                    distance = fallbackVendor.distance;
                    distanceText = fallbackVendor.distanceText;
                }
            }
        } else {
            const anyMapping = await VendorFoodCombo.findOne({ foodComboId: id })
                .populate('vendorId', 'name address rating profileImage')
                .lean();

            if (anyMapping && anyMapping.vendorId) {
                targetVendor = anyMapping.vendorId;
                isAvailable = anyMapping.isAvailable;
            } else if (vendors.length > 0) {
                targetVendor = {
                    _id: vendors[0]._id,
                    name: vendors[0].name,
                    address: vendors[0].address,
                    rating: vendors[0].rating,
                    profileImage: vendors[0].profileImage
                };
            }
        }

        res.json({
            success: true,
            data: {
                ...combo,
                comboPrice: finalPrice,
                isAvailable,
                UnavailableCombo: !isAvailable,
                vendorId: targetVendor,
                distance,
                distanceText
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🏷️ 1. USER CATEGORIES SEPARATED APIS (🚨 NEW)
// ==========================================
// --- 1.1 GET ONLY FOOD CATEGORIES (Sirf foodCategory key aayegi) ---
// Full Path: GET /api/foodpage/categories
const getUserFoodCategories = async (req, res) => {
    try {
        // 🚨 Filters out null/empty strings AND selects ONLY foodCategory key
        const categories = await FoodCategory.find({
            foodCategory: { $nin: [null, ""] }
        })
        .select('_id foodCategory createdAt updatedAt') // 👈 foodEffectCategory exclude ho jayega
        .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.2 GET ONLY FOOD EFFECT CATEGORIES (Sirf foodEffectCategory key aayegi) ---
// Full Path: GET /api/foodpage/effects
const getUserFoodEffectCategories = async (req, res) => {
    try {
        // 🚨 Filters out null/empty strings AND selects ONLY foodEffectCategory key
        const effectCategories = await FoodCategory.find({
            foodEffectCategory: { $nin: [null, ""] }
        })
        .select('_id foodEffectCategory createdAt updatedAt') // 👈 foodCategory exclude ho jayega
        .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: effectCategories.length,
            data: effectCategories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🎟️ GET AVAILABLE FOOD COUPONS (USER-END)
// ==========================================
// Full Path: GET /api/foodpage/coupons?vendorId=...
const getFoodCoupons = async (req, res) => {
    try {
        const { vendorId } = req.query;
        const now = new Date();

        const queryConditions = [
            // 1. Admin/Global Coupons for Food or All
            { 
                isAdminCreated: true, 
                vendorType: { $in: ['Food', 'All'] }, 
                isActive: true,
                startDate: { $lte: now },
                expiryDate: { $gte: now }
            }
        ];

        // 2. Specific Kitchen Vendor Coupons (agar vendorId di gayi ho)
        if (vendorId) {
            queryConditions.push({
                vendorId: vendorId,
                vendorType: 'Food',
                isActive: true,
                startDate: { $lte: now },
                expiryDate: { $gte: now }
            });
        }

        const coupons = await Coupon.find({ $or: queryConditions })
            .select('-usedBy -creatorId -__v')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: coupons.length,
            data: coupons
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getNearestVendorMeals, 
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getNearestCombos ,
    getMealDetailsById, 
    getComboDetailsById ,
    getUserFoodCategories,
    getUserFoodEffectCategories ,
    getFoodCoupons
};