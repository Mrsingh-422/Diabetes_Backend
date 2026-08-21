// controllers/admin/user/Home/FoodPageController.js

const FoodCategory = require('../../../../models/FoodCategory');
const FoodService = require('../../../../models/FoodService');
const TodaySpecial = require('../../../../models/TodaySpecialFood');
const WeeklySpecial = require('../../../../models/WeeklySpecialFood');
const VendorFoodItem = require('../../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../../models/VendorFoodCombo');
const FoodComboOffer = require('../../../../models/FoodComboOffer');

// 🚨 NEW IMPORTS: Mapped to locate dynamic near-by kitchens
const Food = require('../../../../models/Food');
const VendorKMLimit = require('../../../../models/VendorKMLimit');

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
    const distance = R * c; // Straight line distance in KM [37]
    return distance;
};

// ==========================================
// 🚨 NEW: POST NEAREST GEOLOCATED VENDORS LIST
// ==========================================
const getNearestVendors = async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude and longitude are required." });
        }

        // 1. Fetch platform-wide dynamic KM limit configured for Food Platform
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10; // Default fallback: 10 KM [53]

        // 2. Fetch all approved, active kitchen vendors
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('-password -token -fcmToken')
            .lean();

        const nearestVendors = [];

        // 3. Loop on-the-fly to calculate distances
        for (let vendor of vendors) {
            if (!vendor.location || !vendor.location.lat || !vendor.location.lng) {
                continue; // Skip if vendor hasn't set coordinates
            }

            const distance = calculateHaversineDistance(
                Number(lat),
                Number(lng),
                Number(vendor.location.lat),
                Number(vendor.location.lng)
            );

            // 4. Strict dynamic serviceability checks [37, 53]
            if (distance <= maxDistanceLimit) {
                nearestVendors.push({
                    ...vendor,
                    distance: Number(distance.toFixed(2)), // Distance rounded to 2 decimal places [38]
                    distanceText: `${distance.toFixed(1)} km` // Human-readable string [38]
                });
            }
        }

        // 5. Nearest-First Sorting [37]
        nearestVendors.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            count: nearestVendors.length,
            data: nearestVendors
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
const getNearestCombos = async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude and longitude are required." });
        }

        // 1. Fetch platform-wide dynamic KM limit configured for Food Platform [53]
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10; // Default fallback: 10 KM [53]

        // 2. Fetch all approved, active kitchen vendors
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendors = [];

        // 3. Filter vendors by Haversine distance
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
                nearestVendors.push({
                    ...vendor,
                    distance: Number(distance.toFixed(2)),
                    distanceText: `${distance.toFixed(1)} km`
                });
            }
        }

        const serviceableVendorIds = nearestVendors.map(v => v._id);

        // 4. Fetch active mapped VendorFoodCombos for these serviceable vendors only [cite: custom_context]
        const activeMappedCombos = await VendorFoodCombo.find({
            vendorId: { $in: serviceableVendorIds },
            isAvailable: true // Only selected tiffin bundles
        }).lean();

        const mappedCombosList = [];

        // 5. Populate and map master combo details with vendor proximity metadata [cite: custom_context]
        for (let mapItem of activeMappedCombos) {
            const comboDetails = await FoodComboOffer.findById(mapItem.foodComboId)
                .populate({
                    path: 'dishes.foodServiceId',
                    select: 'name price discountPrice imageUrl dietType calories'
                })
                .lean();

            if (!comboDetails || !comboDetails.isActive) {
                continue; // Skip if master combo is deactivated by Admin
            }

            const vendorInfo = nearestVendors.find(
                v => v._id.toString() === mapItem.vendorId.toString()
            );

            mappedCombosList.push({
                _id: comboDetails._id,
                comboId: comboDetails.comboId,
                name: comboDetails.name,
                description: comboDetails.description,
                basePrice: comboDetails.basePrice,
                comboPrice: mapItem.price || comboDetails.comboPrice, // Vendor override price fallback [cite: custom_context]
                spicyLevel: comboDetails.spicyLevel,
                isPopular: comboDetails.isPopular,
                isRecommended: comboDetails.isRecommended,
                dishes: comboDetails.dishes,
                
                // Proximity Kitchen Metadata
                vendorId: {
                    _id: vendorInfo._id,
                    name: vendorInfo.name,
                    address: vendorInfo.address,
                    rating: vendorInfo.rating,
                    profileImage: vendorInfo.profileImage
                },
                distance: vendorInfo.distance,
                distanceText: vendorInfo.distanceText
            });
        }

        // 6. Nearest-First Sorting [37]
        mappedCombosList.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            count: mappedCombosList.length,
            data: mappedCombosList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getNearestVendors, // 👈 Exported new geolocated endpoint
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,
    getNearestCombos // 👈 Exported new geolocated combo endpoint
};