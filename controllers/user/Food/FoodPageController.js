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
const VendorTiffinPlan = require('../../../models/VendorTiffinPlan');
const TiffinPlan = require('../../../models/TiffinPlan');
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
// 🍔 1. GET NEAREST VENDOR MEALS (Paginated)
// ==========================================
const getNearestVendorMeals = async (req, res) => {
    try {
        const { lat, lng } = req.body;
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
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) continue;

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
                distanceText: targetVendor.distanceText,
                createdAt: meal.createdAt
            });
        }

        // Available first, then distance ascending
        nearestMealsList.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            return a.distance - b.distance;
        });

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
            data: paginatedMeals
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🌟 CORE LANDING PAGE API (POST /daywise - With Search, Pagination & Lat/Lng)
// ==========================================
const getFoodPageLayout = async (req, res) => {
    try {
        const { lat, lng, search: bodySearch, page: bodyPage, limit: bodyLimit } = req.body || {};
        const { 
            search: querySearch, 
            dietType, 
            page = bodyPage || 1, 
            limit = bodyLimit || 20 
        } = req.query;

        const searchTerm = (querySearch || bodySearch || '').trim();
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;
        const skip = (pageNum - 1) * limitNum;

        // 1. Fetch Categories for Horizontal Slider
        const categories = await FoodCategory.find().sort({ createdAt: -1 });

        // 2. Resolve Nearest Vendor if lat & lng are passed (10km Radius)
        let nearestVendor = null;
        let maxDistanceLimit = 10;

        if (lat && lng) {
            const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
            maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10;

            const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true })
                .select('name location rating address profileImage')
                .lean();

            for (let vendor of vendors) {
                if (!vendor.location?.lat || !vendor.location?.lng) continue;
                const dist = calculateHaversineDistance(Number(lat), Number(lng), Number(vendor.location.lat), Number(vendor.location.lng));
                if (dist <= maxDistanceLimit) {
                    if (!nearestVendor || dist < nearestVendor.distance) {
                        nearestVendor = {
                            _id: vendor._id,
                            name: vendor.name,
                            address: vendor.address,
                            rating: vendor.rating,
                            profileImage: vendor.profileImage,
                            distance: Number(dist.toFixed(2)),
                            distanceText: `${dist.toFixed(1)} km`
                        };
                    }
                }
            }
        }

        // 3. Build Search & Filter Criteria for Food Items
        const foodSearchQuery = { isActive: true };

        if (searchTerm !== '') {
            const searchRegex = new RegExp(searchTerm, 'i');
            foodSearchQuery.$or = [
                { name: searchRegex },
                { description: searchRegex },
                { ingredients: searchRegex },
                { tags: searchRegex },
                { foodEffectCategory: searchRegex }
            ];
        }

        if (dietType && ['Veg', 'Egg', 'Non Veg'].includes(dietType)) {
            foodSearchQuery.dietType = dietType;
        }

        // 4. Fetch Paginated Today's Specials with Search Filter
        const matchingFoodIds = await FoodService.find(foodSearchQuery).distinct('_id');
        const specialFilter = { foodItemId: { $in: matchingFoodIds } };

        const totalDocs = await TodaySpecial.countDocuments(specialFilter);
        const rawSpecials = await TodaySpecial.find(specialFilter)
            .populate({
                path: 'foodItemId',
                select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags',
                populate: { path: 'categoryId', select: 'foodCategory foodEffectCategory' }
            })
            .skip(skip)
            .limit(limitNum)
            .sort({ createdAt: -1 })
            .lean();

        const todaySpecials = rawSpecials
            .filter(s => s.foodItemId !== null)
            .map(s => s.foodItemId); 

        // 5. Fetch Popular Meals with Search Filter (Top 6)
        const popularMeals = await FoodService.find({ ...foodSearchQuery, isPopular: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 })
            .lean();

        // 6. Fetch Recommended Meals with Search Filter (Top 6)
        const recommendedMeals = await FoodService.find({ ...foodSearchQuery, isRecommended: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 })
            .lean();

        // 7. Structured Response
        res.json({
            success: true,
            data: {
                categories,
                todaySpecials, 
                popularMeals,
                recommendedMeals,
                nearestVendor: nearestVendor || undefined,
                pagination: { 
                    totalDocs,
                    totalPages: Math.ceil(totalDocs / limitNum),
                    currentPage: pageNum,
                    limit: limitNum
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 🍔 2. GET SINGLE MEAL DETAILS BY ID
// ==========================================
const getMealDetailsById = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query; // Captured optionally from query params [cite: custom_context]

        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .select('-sodium -potassium -phosphorus')
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

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location address rating profileImage')
            .lean();

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
// 🍱 3. GET NEAREST COMBOS LIST (Paginated)
// ==========================================
const getNearestCombos = async (req, res) => {
    try {
        const { lat, lng } = req.body;
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
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) continue;

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
                distanceText: targetVendor.distanceText,
                createdAt: combo.createdAt
            });
        }

        mappedCombosList.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            return a.distance - b.distance;
        });

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
            data: paginatedCombos
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🍱 4. GET SINGLE COMBO DETAILS BY ID
// ==========================================
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
// 📅 5. GET NEAREST GEOLOCATED TIFFIN PLANS (User Storefront)
// 🌟 isAvailable: true plans first, then distance & latest created
// ==========================================
const getNearestPlans = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude and longitude are required." });
        }

        // 1. Fetch platform-wide dynamic KM limit
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10;

        // 2. Fetch all approved active kitchen vendors
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendors = [];
        const nearestVendorsMap = new Map();

        // 3. Filter vendors by Haversine distance
        for (let vendor of vendors) {
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) continue;

            const distance = calculateHaversineDistance(
                Number(lat),
                Number(lng),
                Number(vendor.location.lat),
                Number(vendor.location.lng)
            );

            if (distance <= maxDistanceLimit) {
                const vData = {
                    ...vendor,
                    distance: Number(distance.toFixed(2)),
                    distanceText: `${distance.toFixed(1)} km`
                };
                nearestVendors.push(vData);
                nearestVendorsMap.set(vendor._id.toString(), vData);
            }
        }

        // Sort nearest vendors ascending
        nearestVendors.sort((a, b) => a.distance - b.distance);
        const serviceableVendorIds = nearestVendors.map(v => v._id);

        if (nearestVendors.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        // 4. Fetch all master plans created by Admin with deep slot population
        const masterPlans = await TiffinPlan.find({ isActive: true })
            .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
            .lean();

        // 5. Fetch vendor mappings for nearby kitchens
        const vendorPlanMappings = await VendorTiffinPlan.find({
            vendorId: { $in: serviceableVendorIds }
        }).lean();

        const mappedPlansList = [];

        // 6. Map and attach proximity metadata
        for (let plan of masterPlans) {
            const planMappings = vendorPlanMappings.filter(
                map => map.planId.toString() === plan._id.toString()
            );

            const activeMapping = planMappings.find(m => m.isAvailable === true);

            let isAvailable = false;
            let finalPrice = plan.price;
            let targetVendor = nearestVendors[0]; // Fallback to closest kitchen

            if (activeMapping) {
                isAvailable = true;
                targetVendor = nearestVendorsMap.get(activeMapping.vendorId.toString());
                if (activeMapping.customPrice !== null) finalPrice = activeMapping.customPrice;
            } else {
                const anyMapping = planMappings[0];
                if (anyMapping) {
                    targetVendor = nearestVendorsMap.get(anyMapping.vendorId.toString());
                }
            }

            mappedPlansList.push({
                _id: plan._id,
                planId: plan.planId,
                name: plan.name,
                planCycle: plan.planCycle,
                mealsPerDay: plan.mealsPerDay,
                price: finalPrice,
                permittedSlots: plan.permittedSlots,
                slotDishes: plan.slotDishes || { breakfast: [], lunch: [], dinner: [] },
                dishPool: plan.dishPool || [],
                description: plan.description,
                activeSubscribers: plan.activeSubscribers || 0,
                isAvailable,
                UnavailablePlan: !isAvailable,
                vendorId: {
                    _id: targetVendor._id,
                    name: targetVendor.name,
                    address: targetVendor.address,
                    rating: targetVendor.rating,
                    profileImage: targetVendor.profileImage
                },
                distance: targetVendor.distance,
                distanceText: targetVendor.distanceText,
                createdAt: plan.createdAt
            });
        }

        // 🚨 7. SORT LOGIC: isAvailable: true FIRST -> Nearest Distance -> Latest Created
        mappedPlansList.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) {
                return a.isAvailable ? -1 : 1; // True comes before False
            }
            if (a.distance !== b.distance) {
                return a.distance - b.distance; // Closer kitchen first
            }
            return new Date(b.createdAt) - new Date(a.createdAt); // Latest plan first
        });

        // 8. In-Memory Pagination
        const totalDocs = mappedPlansList.length;
        const skip = (page - 1) * limit;
        const paginatedPlans = mappedPlansList.slice(skip, skip + limit);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: page,
            limit,
            data: paginatedPlans
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📅 6. GET SINGLE TIFFIN PLAN FULL DETAILS BY ID (With Geolocated Context)
// ==========================================
const getPlanDetailsById = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query;

        // 1. Fetch Master Plan with full populated dishes & metadata
        const plan = await TiffinPlan.findOne({ 
            $or: [{ _id: id }, { planId: id }], 
            isActive: true 
        })
        .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
        .lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Tiffin subscription plan is currently unavailable." });
        }

        let targetVendor = null;
        let distance = null;
        let distanceText = null;
        let isAvailable = false;
        let finalPrice = plan.price;

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location address rating profileImage')
            .lean();

        // 2. Proximity & Vendor Resolution
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

                const mappings = await VendorTiffinPlan.find({
                    planId: plan._id,
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
                    if (activeMapping.customPrice !== null) finalPrice = activeMapping.customPrice;
                } else {
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
            // Fallback if no user coordinates
            const anyMapping = await VendorTiffinPlan.findOne({ planId: plan._id })
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
                ...plan,
                price: finalPrice,
                isAvailable,
                UnavailablePlan: !isAvailable,
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
// 📅 7. GET SINGLE VENDOR TIFFIN PLANS (Vendor Storefront Screen)
// ==========================================
const getVendorPlansForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        const masterPlans = await TiffinPlan.find({ isActive: true })
            .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice dietType calories')
            .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
            .lean();

        const vendorMappings = await VendorTiffinPlan.find({ vendorId }).lean();

        const finalMappedPlans = masterPlans.map(plan => {
            const mapping = vendorMappings.find(
                map => map.planId.toString() === plan._id.toString()
            );

            let UnavailablePlan = true;
            let finalPrice = plan.price;

            if (mapping && mapping.isAvailable === true) {
                UnavailablePlan = false;
                if (mapping.customPrice !== null) finalPrice = mapping.customPrice;
            }

            return {
                ...plan,
                price: finalPrice,
                isAvailable: mapping ? mapping.isAvailable : false,
                UnavailablePlan
            };
        });

        // Available first
        finalMappedPlans.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        res.json({
            success: true,
            vendorId,
            count: finalMappedPlans.length,
            data: finalMappedPlans
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

// ==========================================
// 📅 GET USER WEEKLY ROTATING MENU (With Lat/Lng, Search & Pagination)
// Full Path: POST /api/foodpage/weekly
// ==========================================
const getUserWeeklyMenu = async (req, res) => {
    try {
        const { lat, lng, search: bodySearch } = req.body || {};
        const { 
            search: querySearch, 
            dietType, 
            day,
            page = 1, 
            limit = 7 
        } = req.query;

        const searchTerm = (querySearch || bodySearch || '').trim();
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 7;

        // 1. 🌟 Fetch Categories for Horizontal Slider (Same as /daywise)
        const categories = await FoodCategory.find().sort({ createdAt: -1 });

        // 2. Resolve Nearest Vendor if coordinates passed (10km Radius)
        let nearestVendor = null;
        let maxDistanceLimit = 10;

        if (lat && lng) {
            const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
            maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10;

            const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true })
                .select('name location rating address profileImage')
                .lean();

            for (let vendor of vendors) {
                if (!vendor.location?.lat || !vendor.location?.lng) continue;
                const dist = calculateHaversineDistance(Number(lat), Number(lng), Number(vendor.location.lat), Number(vendor.location.lng));
                if (dist <= maxDistanceLimit) {
                    if (!nearestVendor || dist < nearestVendor.distance) {
                        nearestVendor = {
                            _id: vendor._id,
                            name: vendor.name,
                            address: vendor.address,
                            rating: vendor.rating,
                            profileImage: vendor.profileImage,
                            distance: Number(dist.toFixed(2)),
                            distanceText: `${dist.toFixed(1)} km`
                        };
                    }
                }
            }
        }

        // 3. Build Search Filter for Meals
        let mealMatchQuery = { isActive: true };

        if (searchTerm !== '') {
            const searchRegex = new RegExp(searchTerm, 'i');
            mealMatchQuery.$or = [
                { name: searchRegex },
                { description: searchRegex },
                { ingredients: searchRegex },
                { tags: searchRegex }
            ];
        }

        if (dietType && ['Veg', 'Egg', 'Non Veg'].includes(dietType)) {
            mealMatchQuery.dietType = dietType;
        }

        // 4. Fetch 7-Day Weekly Menu with description & discountPrice
        const weeklyMenu = await WeeklySpecial.find()
            .populate({
                path: 'meals',
                match: mealMatchQuery,
                select: 'name description price discountPrice calories imageUrl dietType foodEffectCategory'
            })
            .lean();

        let weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        // Optional single day filter (?day=monday)
        if (day && weekdays.includes(day.toLowerCase())) {
            weekdays = [day.toLowerCase()];
        }

        // 5. Construct Day-Wise Schedule
        const calendarPlan = weekdays.map(weekday => {
            const foundDay = weeklyMenu.find(m => m.dayOfWeek?.toLowerCase() === weekday);
            const activeMeals = foundDay ? (foundDay.meals || []).filter(Boolean) : [];

            return {
                dayOfWeek: weekday,
                mealsCount: activeMeals.length,
                meals: activeMeals
            };
        });

        // 6. Pagination over Calendar Days
        const totalDocs = calendarPlan.length;
        const skip = (pageNum - 1) * limitNum;
        const paginatedCalendar = calendarPlan.slice(skip, skip + limitNum);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            nearestVendor: nearestVendor || undefined,
            categories, // 👈 🌟 Categories array added here
            totalDays: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            data: paginatedCalendar
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

const getUserFoodCategories = async (req, res) => {
    try {
        const categories = await FoodCategory.find({
            foodCategory: { $nin: [null, ""] }
        })
        .select('_id foodCategory createdAt updatedAt')
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

const getUserFoodEffectCategories = async (req, res) => {
    try {
        const effectCategories = await FoodCategory.find({
            foodEffectCategory: { $nin: [null, ""] }
        })
        .select('_id foodEffectCategory createdAt updatedAt')
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

const getFoodCoupons = async (req, res) => {
    try {
        const { vendorId } = req.query;
        const now = new Date();

        const queryConditions = [
            { 
                isAdminCreated: true, 
                vendorType: { $in: ['Food', 'All'] }, 
                isActive: true,
                startDate: { $lte: now },
                expiryDate: { $gte: now }
            }
        ];

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

// ==========================================
//  GET ALL NEAREST FOOD ITEMS (Optimized & Lightweight)
// Full Path: POST /api/foodpage/all-foods
// ==========================================
const getAllNearestFoodItems = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const { 
            search, 
            dietType, 
            categoryId, 
            page = 1, 
            limit = 20 
        } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;

        if (!lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "User latitude (lat) and longitude (lng) are required." 
            });
        }

        // 1. Get platform KM limit (e.g. 10 km)
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10;

        // 2. Fetch approved, active, and online kitchen vendors
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendorsMap = new Map();
        const nearestVendors = [];

        for (let vendor of vendors) {
            if (!vendor.location?.lat || !vendor.location?.lng) continue;

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
            return res.json({ 
                success: true, 
                message: `No active cloud kitchens found within ${maxDistanceLimit} km radius.`,
                totalDocs: 0,
                totalPages: 0,
                currentPage: pageNum,
                limit: limitNum,
                data: [] 
            });
        }

        // 3. Search & Filter Query
        const foodQuery = { isActive: true };

        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            foodQuery.$or = [
                { name: searchRegex },
                { description: searchRegex },
                { ingredients: searchRegex },
                { tags: searchRegex }
            ];
        }

        if (dietType && ['Veg', 'Egg', 'Non Veg'].includes(dietType)) {
            foodQuery.dietType = dietType;
        }

        if (categoryId) {
            foodQuery.categoryId = categoryId;
        }

        // 4. Fetch only required fields from FoodService
        const masterMeals = await FoodService.find(foodQuery)
            .select('name imageUrl price discountPrice servingSize dietType prepTime calories spicyLevel ingredients categoryId')
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        // 5. Fetch Vendor inventory mappings
        const vendorMappings = await VendorFoodItem.find({
            vendorId: { $in: serviceableVendorIds }
        }).lean();

        const allFoodsList = [];

        // 6. Map only the exact requested keys
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
                targetVendor = nearestVendorsMap.get(activeMapping.vendorId.toString()) || nearestVendors[0];
                if (activeMapping.price !== null) finalPrice = activeMapping.price;
                if (activeMapping.discountPrice !== null) finalDiscountPrice = activeMapping.discountPrice;
            } else {
                const anyMapping = mealMappings[0];
                if (anyMapping) {
                    targetVendor = nearestVendorsMap.get(anyMapping.vendorId.toString()) || nearestVendors[0];
                }
            }

            // 🎯 Clean & Exact Payload Structure
            allFoodsList.push({
                _id: meal._id,
                name: meal.name,
                imageUrl: meal.imageUrl,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                servingSize: meal.servingSize,
                dietType: meal.dietType,
                prepTime: meal.prepTime,
                calories: meal.calories,
                spicyLevel: meal.spicyLevel,
                ingredients: meal.ingredients || [],
                categoryId: meal.categoryId,
                isAvailable,
                UnavailableFoodItem: !isAvailable,
                vendorId: {
                    _id: targetVendor._id,
                    name: targetVendor.name,
                    profileImage: targetVendor.profileImage
                },
                distance: targetVendor.distance,
                distanceText: targetVendor.distanceText
            });
        }

        // 7. Sort: isAvailable: true first -> Nearest Distance
        allFoodsList.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            return a.distance - b.distance;
        });

        // 8. In-Memory Pagination
        const totalDocs = allFoodsList.length;
        const skip = (pageNum - 1) * limitNum;
        const paginatedFoods = allFoodsList.slice(skip, skip + limitNum);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: paginatedFoods.length,
            data: paginatedFoods
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 SINGLE LIVE FOOD SEARCH SUGGESTIONS (POST ONLY)
// Full Path: POST /api/foodpage/search-suggestions
// ==========================================
const getFoodSearchSuggestions = async (req, res) => {
    try {
        const { query, q, search, limit = 10 } = req.body || {};
        const queryTerm = (query || q || search || '').trim();

        // 🛡️ Agar input khali ya 2 characters se kam hai toh empty list return karein
        if (!queryTerm || queryTerm.length < 2) {
            return res.json({
                success: true,
                query: queryTerm,
                count: 0,
                data: []
            });
        }

        const searchRegex = new RegExp(queryTerm, 'i');
        const limitNum = parseInt(limit, 10) || 10;

        // 1. Search in Master Food Items (FoodService)
        const dishes = await FoodService.find({
            isActive: true,
            $or: [
                { name: searchRegex },
                { description: searchRegex },
                { ingredients: searchRegex },
                { tags: searchRegex },
                { foodEffectCategory: searchRegex }
            ]
        })
        .select('name description price discountPrice calories dietType imageUrl categoryId foodEffectCategory')
        .populate('categoryId', 'foodCategory foodEffectCategory')
        .limit(limitNum)
        .lean();

        const formattedDishes = dishes.map(dish => ({
            id: dish._id,
            _id: dish._id,
            name: dish.name,
            price: dish.price,
            discountPrice: dish.discountPrice > 0 ? dish.discountPrice : dish.price,
            description: dish.description,
            dietType: dish.dietType,
            category: dish.categoryId?.foodCategory || dish.foodEffectCategory || "General",
            categoryId: dish.categoryId?._id || null,
            imageUrl: dish.imageUrl,
            calories: dish.calories,
            itemType: "MealItem",                           // 👈 Frontend navigation discriminator
            redirectPath: `/food/dish/${dish._id}`          // 👈 Frontend click URL
        }));

        // 2. Search in Food Categories (FoodCategory)
        const categories = await FoodCategory.find({
            $or: [
                { foodCategory: searchRegex },
                { foodEffectCategory: searchRegex }
            ]
        })
        .limit(5)
        .lean();

        const formattedCategories = categories.map(cat => ({
            id: cat._id,
            _id: cat._id,
            name: cat.foodCategory || cat.foodEffectCategory,
            price: null,
            discountPrice: null,
            description: cat.foodEffectCategory ? `Clinical Focus: ${cat.foodEffectCategory}` : "Food Category",
            dietType: null,
            category: cat.foodCategory || "Category",
            categoryId: cat._id,
            imageUrl: null,
            calories: null,
            itemType: "Category",
            redirectPath: `/food/category/${cat._id}`
        }));

        // 3. Search in Combo Offers (FoodComboOffer)
        const combos = await FoodComboOffer.find({
            isActive: true,
            $or: [
                { name: searchRegex },
                { description: searchRegex }
            ]
        })
        .select('comboId name description basePrice comboPrice')
        .limit(5)
        .lean();

        const formattedCombos = combos.map(combo => ({
            id: combo._id,
            _id: combo._id,
            name: combo.name,
            price: combo.basePrice,
            discountPrice: combo.comboPrice,
            description: combo.description,
            dietType: "Combo Pack",
            category: "Combo Offer",
            categoryId: null,
            imageUrl: null,
            calories: null,
            itemType: "Combo",
            redirectPath: `/food/combo/${combo._id}`
        }));

        // 4. Combine All Search Results
        const allResults = [
            ...formattedDishes,
            ...formattedCombos,
            ...formattedCategories
        ];

        res.json({
            success: true,
            query: queryTerm,
            count: allResults.length,
            data: allResults.slice(0, 15) // Top 15 matching suggestions
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getNearestVendorMeals,
    getMealDetailsById,
    getNearestCombos,
    getComboDetailsById,
    getNearestPlans,
    getPlanDetailsById,
    getVendorPlansForUser,
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getUserFoodCategories,
    getUserFoodEffectCategories,
    getFoodCoupons,
    getAllNearestFoodItems,
    getFoodSearchSuggestions
};