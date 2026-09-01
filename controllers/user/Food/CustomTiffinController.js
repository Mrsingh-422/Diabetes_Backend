// controllers/user/Food/CustomTiffinController.js

const FoodBooking = require('../../../models/FoodBooking');
const FoodService = require('../../../models/FoodService');
const Food = require('../../../models/Food');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const PeakOrderCharge = require('../../../models/PeakOrderCharge');
const VendorKMLimit = require('../../../models/VendorKMLimit');

const { createRazorpayOrder } = require('../../../utils/razorpay');

// ==========================================
// 💡 HAVERSINE DISTANCE CALCULATOR
// ==========================================
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
};

// ==========================================
// 💡 HELPER: AUTO-RESOLVE NEAREST APPROVED ONLINE KITCHEN
// ==========================================
const resolveNearestKitchen = async (passedFoodId, userLat, userLng) => {
    if (passedFoodId) {
        const vendor = await Food.findById(passedFoodId);
        if (vendor && vendor.profileStatus === 'Approved' && vendor.isActive && vendor.isOnline) {
            let dist = 0;
            if (userLat && userLng && vendor.location?.lat && vendor.location?.lng) {
                dist = calculateDistance(Number(userLat), Number(userLng), Number(vendor.location.lat), Number(vendor.location.lng));
            }
            return { vendor, distance: dist };
        }
    }

    // Auto-search nearest approved active kitchen within 10 km
    const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true }).lean();
    let nearestVendor = null;
    let minDistance = Infinity;

    for (let v of vendors) {
        if (!v.location?.lat || !v.location?.lng) continue;
        const dist = calculateDistance(Number(userLat), Number(userLng), Number(v.location.lat), Number(v.location.lng));
        if (dist < minDistance) {
            minDistance = dist;
            nearestVendor = v;
        }
    }

    if (nearestVendor) {
        return { vendor: nearestVendor, distance: minDistance };
    }

    const fallback = await Food.findOne({ profileStatus: 'Approved', isActive: true, isOnline: true });
    return { vendor: fallback, distance: 0 };
};

// ==========================================
// 💡 HELPER: LOCATION-BASED DELIVERY CHARGES
// ==========================================
const getDeliveryConfig = async (address, foodId) => {
    const userCity = address?.city ? address.city.trim() : null;
    const userState = address?.state ? address.state.trim() : null;

    let config = null;

    if (userCity) {
        config = await DeliveryCharge.findOne({ vendorType: 'Food', city: new RegExp(`^${userCity}$`, 'i'), isAdminGlobal: true });
    }
    if (!config && userState) {
        config = await DeliveryCharge.findOne({ vendorType: 'Food', state: new RegExp(`^${userState}$`, 'i'), city: null, isAdminGlobal: true });
    }
    if (!config && foodId) {
        config = await DeliveryCharge.findOne({ vendorId: foodId });
    }
    if (!config) {
        config = await DeliveryCharge.findOne({ vendorType: 'Food', isAdminGlobal: true, city: null, state: null }) || await DeliveryCharge.findOne({ vendorType: 'Food', isAdminGlobal: true });
    }

    return config || {
        fixedPrice: 40,
        packagingCharge: 15,
        freeDeliveryThreshold: 500,
        taxPercentage: 5
    };
};

// ==========================================
// 💡 HELPER: PEAK ORDER CHARGE CALCULATOR
// ==========================================
const calculateSlotPeakCharge = async (selectedMeals) => {
    const peakConfig = await PeakOrderCharge.findOne({ vendorType: 'Food' });
    if (!peakConfig || !peakConfig.isGlobalActive) {
        return 0;
    }

    let dailyPeakFee = 0;

    if (selectedMeals.breakfast && peakConfig.breakfast?.isActive) {
        dailyPeakFee += Number(peakConfig.breakfast.charge || 0);
    }
    if (selectedMeals.lunch && peakConfig.lunch?.isActive) {
        dailyPeakFee += Number(peakConfig.lunch.charge || 0);
    }
    if (selectedMeals.dinner && peakConfig.dinner?.isActive) {
        dailyPeakFee += Number(peakConfig.dinner.charge || 0);
    }

    return dailyPeakFee;
};

// ==========================================
// 🥗 1. GET DYNAMIC DISHES FOR CUSTOM BUILDER MODAL
// Full Path: GET /api/food/custom-tiffin/menu-config
// ==========================================
const getCustomTiffinMenuConfig = async (req, res) => {
    try {
        const dishes = await FoodService.find({ isActive: true })
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .lean();

        const formattedDishes = dishes.map(d => ({
            id: d._id,
            name: d.name,
            price: d.discountPrice > 0 ? d.discountPrice : d.price,
            originalPrice: d.price,
            cal: d.calories,
            dietType: d.dietType,
            foodEffectCategory: d.foodEffectCategory,
            imageUrl: d.imageUrl
        }));

        res.json({
            success: true,
            data: {
                breakfast: {
                    deliverySlots: ["07:30 AM - 08:30 AM", "08:30 AM - 09:30 AM", "09:30 AM - 10:30 AM"],
                    foodList: formattedDishes
                },
                lunch: {
                    deliverySlots: ["12:00 PM - 01:00 PM", "01:00 PM - 02:00 PM", "02:00 PM - 03:00 PM"],
                    foodList: formattedDishes
                },
                dinner: {
                    deliverySlots: ["07:00 PM - 08:00 PM", "08:00 PM - 09:00 PM", "09:00 PM - 10:00 PM"],
                    foodList: formattedDishes
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🧮 2. CALCULATE CUSTOM TIFFIN BILL (PREVIEW)
// Full Path: POST /api/food/custom-tiffin/calculate
// ==========================================
const calculateCustomTiffinBill = async (req, res) => {
    try {
        const {
            foodId,
            selectedMeals = { breakfast: true, lunch: true, dinner: false },
            startDate,
            endDate,
            packageDays = 10,
            selectedFoods = {},
            deliverySlots = {},
            dietaryType = 'veg',
            spiceLevel = 'mild',
            clinicalNotes = "",
            address,
            userLat = 30.7046,
            userLng = 76.7179,
            couponCode
        } = req.body;

        const daysCount = Math.max(1, parseInt(packageDays, 10) || 1);

        // 1. Resolve Nearest Kitchen
        const targetLat = Number(userLat || address?.lat || 30.7046);
        const targetLng = Number(userLng || address?.lng || 76.7179);

        const { vendor, distance } = await resolveNearestKitchen(foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active kitchen vendor available in your area." });
        }

        // 2. COD Policy Check
        const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
        const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

        // 3. Calculate Daily Base Price from Verified DB Dishes
        let dailyBase = 0;
        const verifiedSelectedFoods = {
            breakfast: null,
            lunch: null,
            dinner: null
        };

        const verifyDish = async (foodObjOrId, defaultSlot) => {
            const rawId = typeof foodObjOrId === 'object' ? (foodObjOrId?.id || foodObjOrId?._id) : foodObjOrId;
            if (!rawId) return null;

            const dish = await FoodService.findById(rawId).select('name price discountPrice calories dietType imageUrl');
            if (!dish) return null;

            const price = dish.discountPrice > 0 ? dish.discountPrice : dish.price;
            return {
                mealId: dish._id,
                mealName: dish.name,
                price,
                calories: dish.calories,
                dietType: dish.dietType,
                imageUrl: dish.imageUrl,
                deliverySlot: defaultSlot
            };
        };

        if (selectedMeals.breakfast && selectedFoods.breakfast) {
            const bDish = await verifyDish(selectedFoods.breakfast, deliverySlots.breakfast || "08:30 AM - 09:30 AM");
            if (bDish) {
                dailyBase += bDish.price;
                verifiedSelectedFoods.breakfast = bDish;
            }
        }

        if (selectedMeals.lunch && selectedFoods.lunch) {
            const lDish = await verifyDish(selectedFoods.lunch, deliverySlots.lunch || "12:00 PM - 01:00 PM");
            if (lDish) {
                dailyBase += lDish.price;
                verifiedSelectedFoods.lunch = lDish;
            }
        }

        if (selectedMeals.dinner && selectedFoods.dinner) {
            const dDish = await verifyDish(selectedFoods.dinner, deliverySlots.dinner || "07:00 PM - 08:00 PM");
            if (dDish) {
                dailyBase += dDish.price;
                verifiedSelectedFoods.dinner = dDish;
            }
        }

        if (dailyBase === 0) {
            return res.status(400).json({ success: false, message: "Please select at least 1 valid meal dish." });
        }

        // 4. Subtotal & Tiered Package Discounts
        const subtotal = dailyBase * daysCount;

        let discountPercent = 0;
        if (daysCount >= 30) discountPercent = 15;
        else if (daysCount >= 20) discountPercent = 10;
        else if (daysCount >= 10) discountPercent = 5;

        const packageDiscountAmount = Math.round((subtotal * discountPercent) / 100);
        const itemTotal = subtotal - packageDiscountAmount;

        // 5. ⚡ Peak Order Charges Calculation
        const dailyPeakFee = await calculateSlotPeakCharge(selectedMeals);
        const totalPeakOrderCharge = dailyPeakFee * daysCount;

        // 6. Delivery & Location Logistics
        const chargesConfig = await getDeliveryConfig(address, vendor._id);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // 7. Promo Coupon Check
        let couponDiscount = 0;
        let validCouponId = null;

        if (couponCode) {
            const cleanCode = String(couponCode).toUpperCase().trim();
            const now = new Date();

            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                startDate: { $lte: now },
                expiryDate: { $gte: now },
                $or: [
                    { vendorId: vendor._id, vendorType: 'Food' },
                    { isAdminCreated: true, vendorType: { $in: ['Food', 'All'] } }
                ]
            });

            if (coupon && itemTotal >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                validCouponId = coupon._id;
            }
        }

        // 8. Total Amount Assessment (including peakOrderCharge)
        const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakOrderCharge);
        const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
        const grandTotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakOrderCharge + taxAmount);

        // Date calculations
        const start = startDate ? new Date(startDate) : new Date();
        const end = new Date(start);
        end.setDate(start.getDate() + (daysCount - 1));

        res.json({
            success: true,
            packageDays: daysCount,
            dates: {
                startDate: start.toISOString().split('T')[0],
                endDate: end.toISOString().split('T')[0]
            },
            distance: `${distance.toFixed(1)} km`,
            orderRestrictions: {
                isCodAvailable: isCodAvailable // 👈 Live COD check
            },
            assignedVendor: {
                _id: vendor._id,
                name: vendor.name,
                city: vendor.city,
                rating: vendor.rating || 4.9,
                profileImage: vendor.profileImage
            },
            selectedMeals,
            dietaryType,
            spiceLevel,
            clinicalNotes,
            selectedFoods: verifiedSelectedFoods,
            pricing: {
                dailyBase,
                subtotal,
                discountPercent,
                packageDiscountAmount,
                itemTotal,
                deliveryCharge,
                packagingCharge,
                peakOrderCharge: totalPeakOrderCharge, // 👈 Applied peak charge key
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                grandTotal
            },
            billSummary: {
                itemTotal,
                deliveryCharge,
                packagingCharge,
                peakOrderCharge: totalPeakOrderCharge, // 👈 Also in billSummary
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                totalAmount: grandTotal
            }
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚀 3. DIRECT CREATE & BUY CUSTOM TIFFIN (POST /create)
// Full Path: POST /api/food/custom-tiffin/create
// ==========================================
const createCustomTiffinOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            foodId,
            selectedMeals = { breakfast: true, lunch: true, dinner: false },
            startDate,
            packageDays = 10,
            selectedFoods = {},
            deliverySlots = {},
            dietaryType = 'veg',
            spiceLevel = 'mild',
            clinicalNotes = "",
            address,
            userLat = 30.7046,
            userLng = 76.7179,
            couponCode,
            paymentMethod = 'Online'
        } = req.body;

        // Parse Address
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        if (!parsedAddress || !parsedAddress.name || !parsedAddress.phone || !parsedAddress.houseNo || !parsedAddress.city) {
            return res.status(400).json({ success: false, message: "Complete delivery address is required." });
        }

        // 1. Resolve Nearest Kitchen
        const targetLat = Number(userLat || parsedAddress?.lat || 30.7046);
        const targetLng = Number(userLng || parsedAddress?.lng || 76.7179);

        const { vendor, distance } = await resolveNearestKitchen(foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active kitchen vendor available in your area." });
        }

        // 2. COD Policy Check
        const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
        const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

        if (paymentMethod === 'COD' && !isCodAvailable) {
            return res.status(400).json({ 
                success: false, 
                message: "Cash on Delivery is currently disabled for custom tiffins. Please choose Online Payment." 
            });
        }

        // 3. Verify Selected Meals & Build Stored Object
        const daysCount = Math.max(1, parseInt(packageDays, 10) || 1);
        let dailyBase = 0;
        const verifiedSelectedFoods = {
            breakfast: { mealId: null, mealName: null, price: 0, calories: 0, deliverySlot: deliverySlots.breakfast || "08:30 AM - 09:30 AM" },
            lunch: { mealId: null, mealName: null, price: 0, calories: 0, deliverySlot: deliverySlots.lunch || "12:00 PM - 01:00 PM" },
            dinner: { mealId: null, mealName: null, price: 0, calories: 0, deliverySlot: deliverySlots.dinner || "07:00 PM - 08:00 PM" }
        };

        const verifyMeal = async (foodObjOrId, slotKey, defaultSlot) => {
            const rawId = typeof foodObjOrId === 'object' ? (foodObjOrId?.id || foodObjOrId?._id) : foodObjOrId;
            if (!rawId) return;

            const dish = await FoodService.findById(rawId);
            if (!dish) return;

            const price = dish.discountPrice > 0 ? dish.discountPrice : dish.price;
            dailyBase += price;

            verifiedSelectedFoods[slotKey] = {
                mealId: dish._id,
                mealName: dish.name,
                price,
                calories: dish.calories,
                deliverySlot: deliverySlots[slotKey] || defaultSlot
            };
        };

        if (selectedMeals.breakfast && selectedFoods.breakfast) {
            await verifyMeal(selectedFoods.breakfast, 'breakfast', "08:30 AM - 09:30 AM");
        }
        if (selectedMeals.lunch && selectedFoods.lunch) {
            await verifyMeal(selectedFoods.lunch, 'lunch', "12:00 PM - 01:00 PM");
        }
        if (selectedMeals.dinner && selectedFoods.dinner) {
            await verifyMeal(selectedFoods.dinner, 'dinner', "07:00 PM - 08:00 PM");
        }

        if (dailyBase === 0) {
            return res.status(400).json({ success: false, message: "Please select at least 1 valid meal dish." });
        }

        // 4. Pricing & Discounts
        const subtotal = dailyBase * daysCount;

        let discountPercent = 0;
        if (daysCount >= 30) discountPercent = 15;
        else if (daysCount >= 20) discountPercent = 10;
        else if (daysCount >= 10) discountPercent = 5;

        const packageDiscountAmount = Math.round((subtotal * discountPercent) / 100);
        const itemTotal = subtotal - packageDiscountAmount;

        // 5. ⚡ Peak Order Charges
        const dailyPeakFee = await calculateSlotPeakCharge(selectedMeals);
        const totalPeakOrderCharge = dailyPeakFee * daysCount;

        // Delivery & Tax
        const chargesConfig = await getDeliveryConfig(parsedAddress, vendor._id);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // Coupon Check
        let couponDiscount = 0;
        let validCouponId = null;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: String(couponCode).toUpperCase().trim(), isActive: true });
            if (coupon && itemTotal >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                validCouponId = coupon._id;
            }
        }

        const taxAmount = Math.round(((itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakOrderCharge) * (taxPercentage / 100));
        const grandTotal = Math.round((itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakOrderCharge + taxAmount);

        // Dates
        const start = startDate ? new Date(startDate) : new Date();
        const end = new Date(start);
        end.setDate(start.getDate() + (daysCount - 1));

        const tempBookingId = `CTM-FD-${Math.floor(100000 + Math.random() * 900000)}`;
        const deliveryOTP = String(Math.floor(1000 + Math.random() * 9000));

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(grandTotal, `custom_${tempBookingId}_${Date.now()}`);
        }

        // 6. Create Database Document
        const newCustomTiffin = await FoodBooking.create({
            bookingId: tempBookingId,
            userId,
            foodId: vendor._id,
            bookingType: 'Custom Plate',
            customTiffinDetails: {
                packageDays: daysCount,
                startDate: start,
                endDate: end,
                dietaryType,
                spiceLevel,
                clinicalNotes,
                selectedMeals,
                selectedFoods: verifiedSelectedFoods
            },
            collectionType: 'Home Delivery',
            address: parsedAddress,
            billSummary: {
                itemTotal,
                deliveryCharge,
                packagingCharge,
                peakOrderCharge: totalPeakOrderCharge, // 👈 Saved into DB billSummary
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                totalAmount: grandTotal
            },
            status: 'New',
            paymentMethod,
            paymentStatus: 'Pending',
            deliveryOTP,
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        // COD Confirmation
        if (paymentMethod === 'COD') {
            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: `Custom ${daysCount}-Day Tiffin Package booked successfully (COD)!`,
                data: newCustomTiffin
            });
        }

        // Online Razorpay Flow
        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: `Razorpay order generated for Custom ${daysCount}-Day Tiffin.`,
            key: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: grandTotal,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: newCustomTiffin.bookingId,
            subscriptionId: newCustomTiffin._id,
            data: newCustomTiffin
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 4. GET SINGLE CUSTOM TIFFIN FULL DETAILS
// Full Path: GET /api/food/custom-tiffin/my-custom-plan/:bookingId
// ==========================================
const getMyCustomTiffinDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.params;

        const plan = await FoodBooking.findOne({
            $or: [{ _id: bookingId }, { bookingId }],
            userId,
            bookingType: 'Custom Plate'
        })
        .populate('foodId', 'name profileImage address city phone rating')
        .populate('customTiffinDetails.selectedFoods.breakfast.mealId', 'name imageUrl price discountPrice calories dietType')
        .populate('customTiffinDetails.selectedFoods.lunch.mealId', 'name imageUrl price discountPrice calories dietType')
        .populate('customTiffinDetails.selectedFoods.dinner.mealId', 'name imageUrl price discountPrice calories dietType')
        .lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Custom Tiffin record not found." });
        }

        res.json({
            success: true,
            data: plan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 📋 5. GET ALL MY CUSTOM TIFFIN PLANS (Lightweight Card List)
// Full Path: GET /api/food/custom-tiffin/my-custom-plans
// ==========================================
const getAllMyCustomTiffinPlans = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status } = req.query; // Optional filter (?status=Active ya ?status=New)

        const query = {
            userId,
            bookingType: 'Custom Plate'
        };

        if (status) query.status = status;

        // 🚨 Sirf UI Cards ke liye essential fields select kiye gaye hain (Fast & Clean)
        const customPlans = await FoodBooking.find(query)
            .select('_id bookingId status customTiffinDetails.packageDays customTiffinDetails.startDate customTiffinDetails.endDate customTiffinDetails.dietaryType billSummary.totalAmount foodId createdAt')
            .populate('foodId', 'name profileImage city')
            .sort({ createdAt: -1 })
            .lean();

        // Format to exact clean card keys
        const cleanList = customPlans.map(plan => {
            const start = plan.customTiffinDetails?.startDate;
            const end = plan.customTiffinDetails?.endDate;

            return {
                _id: plan._id,
                bookingId: plan.bookingId,
                packageDays: plan.customTiffinDetails?.packageDays || 10,
                dietaryType: plan.customTiffinDetails?.dietaryType || 'veg',
                status: plan.status,
                totalAmount: plan.billSummary?.totalAmount || 0,
                startDate: start ? new Date(start).toISOString().split('T')[0] : null,
                endDate: end ? new Date(end).toISOString().split('T')[0] : null,
                kitchen: {
                    _id: plan.foodId?._id,
                    name: plan.foodId?.name || "Healthy Cloud Kitchen",
                    city: plan.foodId?.city || "Mohali"
                },
                createdAt: plan.createdAt
            };
        });

        res.json({
            success: true,
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getCustomTiffinMenuConfig,
    calculateCustomTiffinBill,
    createCustomTiffinOrder,
    getMyCustomTiffinDetails,
    getAllMyCustomTiffinPlans
};