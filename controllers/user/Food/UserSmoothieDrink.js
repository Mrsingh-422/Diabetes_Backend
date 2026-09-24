// controllers/user/Food/UserSmoothieDrinkController.js

const smoothiDrinks = require('../../../models/smoothiDrinks');
const VendorSmoothieDrink = require('../../../models/VendorSmoothieDrink');
const Food = require('../../../models/Food');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { calculateHaversine } = require('../../../utils/helpers');
const mongoose = require('mongoose');

// ==========================================
// 🥤 1. GET NEAREST GEOLOCATED SMOOTHIES & DRINKS (WITH GUARANTEED PRICE & DISCOUNT PRICE)
// Full Path: POST /api/food/drinks/nearest
// ==========================================
const getNearestSmoothieDrinks = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const { 
            drinkType, 
            dietType, 
            foodEffectCategory, 
            categoryId, 
            search, 
            minPrice,
            maxPrice,
            page = 1, 
            limit = 20 
        } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User latitude (lat) and longitude (lng) are required." });
        }

        // 1. Dynamic KM Limit (Default: 10km)
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxDistanceLimit = limitConfig ? limitConfig.kmLimit : 10;

        // 2. Active Online Kitchen Vendors
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true })
            .select('name location rating address profileImage')
            .lean();

        const nearestVendors = [];
        const nearestVendorsMap = new Map();

        for (let vendor of vendors) {
            if (!vendor.location?.lat || !vendor.location?.lng) continue;

            const dist = calculateHaversine(
                Number(lat),
                Number(lng),
                Number(vendor.location.lat),
                Number(vendor.location.lng)
            );

            if (dist <= maxDistanceLimit) {
                const vData = {
                    ...vendor,
                    distance: Number(dist.toFixed(2)),
                    distanceText: `${dist.toFixed(1)} km`
                };
                nearestVendors.push(vData);
                nearestVendorsMap.set(vendor._id.toString(), vData);
            }
        }

        nearestVendors.sort((a, b) => a.distance - b.distance);
        const serviceableVendorIds = nearestVendors.map(v => v._id);

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
        const query = { isActive: true };
        if (categoryId) query.categoryId = categoryId;
        if (drinkType) query.drinkType = drinkType;
        if (dietType) query.dietType = dietType;
        if (foodEffectCategory) query.foodEffectCategory = new RegExp(`^${foodEffectCategory.trim()}$`, 'i');

        // Optional Price Range Filter
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = Number(minPrice);
            if (maxPrice) query.price.$lte = Number(maxPrice);
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { description: regex },
                { "ingredients.name": regex },
                { tags: regex },
                { foodEffectCategory: regex }
            ];
        }

        // 4. Fetch Master Drinks
        const masterDrinks = await smoothiDrinks.find(query)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        // 5. Fetch Vendor Mappings
        const vendorMappings = await VendorSmoothieDrink.find({
            vendorId: { $in: serviceableVendorIds }
        }).lean();

        const mappedDrinksList = [];

        for (let drink of masterDrinks) {
            const activeMapping = vendorMappings.find(
                m => m.drinkId.toString() === drink._id.toString() && m.isAvailable === true
            );

            let isAvailable = Boolean(activeMapping);
            let targetVendor = activeMapping ? nearestVendorsMap.get(activeMapping.vendorId.toString()) : nearestVendors[0];

            mappedDrinksList.push({
                _id: drink._id,
                name: drink.name,
                description: drink.description,
                images: drink.images || [],
                
                // 🏷️ Price & Discount Price (Guaranteed Numbers)
                price: Number(drink.price || 0),
                discountPrice: Number(drink.discountPrice || 0),
                
                prepTime: drink.prepTime,
                servingSize: drink.servingSize,
                drinkType: drink.drinkType,
                dietType: drink.dietType,
                foodEffectCategory: drink.foodEffectCategory,
                calories: Number(drink.calories || 0),
                sugar: Number(drink.sugar || 0),
                ingredients: drink.ingredients || [],
                tags: drink.tags || [],
                isPopular: drink.isPopular,
                isRecommended: drink.isRecommended,
                isAvailable,
                UnavailableDrink: !isAvailable,
                vendorId: {
                    _id: targetVendor._id,
                    name: targetVendor.name,
                    address: targetVendor.address,
                    rating: targetVendor.rating,
                    profileImage: targetVendor.profileImage
                },
                distance: targetVendor.distance,
                distanceText: targetVendor.distanceText,
                createdAt: drink.createdAt
            });
        }

        // 6. Sort: isAvailable: true first -> Nearest Distance -> Latest
        mappedDrinksList.sort((a, b) => {
            if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
            if (a.distance !== b.distance) return a.distance - b.distance;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        // 7. Pagination
        const totalDocs = mappedDrinksList.length;
        const skip = (pageNum - 1) * limitNum;
        const paginatedDrinks = mappedDrinksList.slice(skip, skip + limitNum);

        res.json({
            success: true,
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: paginatedDrinks.length,
            data: paginatedDrinks
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 2. GET SINGLE SMOOTHIE DRINK DETAILS FOR USER
// Full Path: GET /api/food/drinks/details/:id
// ==========================================
const getSmoothieDrinkDetailsForUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID format." });
        }

        const drink = await smoothiDrinks.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item is currently unavailable." });
        }

        let targetVendor = null;
        let distance = null;
        let distanceText = null;
        let isAvailable = false;
        let finalPrice = drink.price;
        let finalDiscountPrice = drink.discountPrice;

        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true })
            .select('name location address rating profileImage')
            .lean();

        if (lat && lng && vendors.length > 0) {
            const nearestVendors = [];
            const nearestVendorsMap = new Map();

            for (let vendor of vendors) {
                if (!vendor.location?.lat || !vendor.location?.lng) continue;

                const computedDistance = calculateHaversine(
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

                const mappings = await VendorSmoothieDrink.find({
                    drinkId: id,
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
            const anyMapping = await VendorSmoothieDrink.findOne({ drinkId: id, isAvailable: true })
                .populate('vendorId', 'name address rating profileImage')
                .lean();

            if (anyMapping && anyMapping.vendorId) {
                targetVendor = anyMapping.vendorId;
                isAvailable = true;
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
                ...drink,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                isAvailable,
                UnavailableDrink: !isAvailable,
                vendorId: targetVendor,
                distance,
                distanceText
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    getNearestSmoothieDrinks,
    getSmoothieDrinkDetailsForUser,
};