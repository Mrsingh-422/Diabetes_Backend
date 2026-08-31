// controllers/user/Food/UserTiffinSubscriptionController.js

const FoodBooking = require('../../../models/FoodBooking');
const TiffinPlan = require('../../../models/TiffinPlan');
const FoodService = require('../../../models/FoodService');
const Food = require('../../../models/Food');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
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
// 💡 HELPER: DYNAMIC DATE GENERATOR
// ==========================================
const calculateSubscriptionDates = (cycle, customDays = null, customStartDate = null) => {
    const startDate = customStartDate ? new Date(customStartDate) : new Date();
    const endDate = new Date(startDate);

    if (cycle === 'weekly' || cycle === 'Weekly Cycle') {
        endDate.setDate(startDate.getDate() + 7);
    } else if (cycle === 'monthly' || cycle === 'Monthly Cycle') {
        endDate.setDate(startDate.getDate() + 30);
    } else if (customDays) {
        endDate.setDate(startDate.getDate() + Number(customDays));
    } else {
        endDate.setDate(startDate.getDate() + 7);
    }

    return { startDate, endDate };
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
// 💡 HELPER: AUTO-RESOLVE NEAREST KITCHEN VENDOR
// ==========================================
const resolveNearestVendor = async (passedFoodId, userLat, userLng) => {
    if (passedFoodId) {
        const vendor = await Food.findById(passedFoodId);
        if (vendor && vendor.isActive && vendor.isOnline) return vendor;
    }

    // Auto-search nearest vendor if foodId not passed or offline
    if (userLat && userLng) {
        const vendors = await Food.find({ profileStatus: 'Approved', isActive: true, isOnline: true }).lean();
        let nearestVendor = null;
        let minDistance = Infinity;

        for (let v of vendors) {
            if (!v.location?.lat || !v.location?.lng) continue;
            const dist = calculateDistance(Number(userLat), Number(userLng), Number(v.location.lat), Number(v.location.lng));
            if (dist < minDistance) {
                minDistance = dist;
                nearestVendor = { ...v, distance: dist };
            }
        }

        if (nearestVendor) return nearestVendor;
    }

    // Fallback: Pick any first active online kitchen
    return await Food.findOne({ profileStatus: 'Approved', isActive: true, isOnline: true });
};

// ==========================================
// 🧮 1. DIRECT BILL PREVIEW (POST /calculate)
// No Cart Required - Direct Plan Calculation
// ==========================================
const calculateTiffinSubscriptionBill = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            bookingType = 'Subscription', // 'Subscription' ya 'Custom Plate'
            planId, 
            billingCycle = 'weekly',      // 'weekly', 'monthly', 'custom'
            durationDays,                 // e.g. 7, 10, 15, 30
            universalDeliveryTimes = {},  // { breakfastTime, lunchTime, dinnerTime }
            dailyMealSchedule = [],       // [{ weekNumber, dayOfWeek, slotName, mealId }]
            address, 
            userLat,
            userLng,
            couponCode 
        } = req.body;

        // Parse address
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        // 1. Resolve Kitchen Vendor
        const targetLat = Number(userLat || parsedAddress?.lat || parsedAddress?.location?.lat || 30.7046);
        const targetLng = Number(userLng || parsedAddress?.lng || parsedAddress?.location?.lng || 76.7179);

        const vendor = await resolveNearestVendor(foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active kitchen vendor found in your area." });
        }

        let itemTotal = 0;
        let planTitle = "Custom Tiffin Plan";
        const verifiedSchedule = [];

        // 2. Validate Daily Meal Schedule
        if (!Array.isArray(dailyMealSchedule) || dailyMealSchedule.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Please configure dishes for your daily meal schedule before calculating." 
            });
        }

        for (let item of dailyMealSchedule) {
            const { weekNumber = 1, dayOfWeek, slotName, mealId } = item;
            if (!dayOfWeek || !slotName || !mealId) continue;

            const dish = await FoodService.findById(mealId).select('name price discountPrice imageUrl dietType calories');
            if (!dish) {
                throw new Error(`Dish '${mealId}' scheduled for ${dayOfWeek} (${slotName}) was not found.`);
            }

            const dishPrice = dish.discountPrice > 0 ? dish.discountPrice : dish.price;

            // Resolve delivery time from universal timing preferences
            let slotTime = "01:00 PM - 02:00 PM";
            if (slotName.toLowerCase() === 'breakfast') slotTime = universalDeliveryTimes.breakfastTime || "08:00 AM - 09:00 AM";
            else if (slotName.toLowerCase() === 'lunch') slotTime = universalDeliveryTimes.lunchTime || "01:00 PM - 02:00 PM";
            else if (slotName.toLowerCase() === 'dinner') slotTime = universalDeliveryTimes.dinnerTime || "08:00 PM - 09:00 PM";

            verifiedSchedule.push({
                weekNumber: Number(weekNumber) || 1,
                dayOfWeek: dayOfWeek.toLowerCase(),
                slotName: slotName.toLowerCase(),
                mealId: dish._id,
                mealName: dish.name,
                mealImage: dish.imageUrl,
                mealPrice: dishPrice,
                calories: dish.calories,
                dietType: dish.dietType,
                deliveryTime: slotTime
            });
        }

        // 3. PRICING EVALUATION
        // A. Pre-set Master Plan (Weekly / Monthly)
        if (bookingType === 'Subscription' && planId) {
            const masterPlan = await TiffinPlan.findOne({
                $or: [{ _id: planId }, { planId }],
                isActive: true
            });

            if (!masterPlan) {
                return res.status(404).json({ success: false, message: "Selected Tiffin Plan tier is not available." });
            }

            planTitle = masterPlan.name;
            itemTotal = masterPlan.price;
        } 
        // B. Custom Days Plan (10 Days, 15 Days, or Custom)
        else {
            const effectiveDays = Number(durationDays) || (billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : 15));
            const sumOfSchedule = verifiedSchedule.reduce((acc, curr) => acc + curr.mealPrice, 0);

            const scheduleDaysCount = Math.max(1, new Set(verifiedSchedule.map(s => `${s.weekNumber}-${s.dayOfWeek}`)).size);
            const avgDailyCost = sumOfSchedule / scheduleDaysCount;
            const baseCost = Math.round(avgDailyCost * effectiveDays);

            let discountRate = 0;
            if (billingCycle === 'weekly' || effectiveDays === 7) discountRate = 0.10;
            else if (billingCycle === 'monthly' || effectiveDays >= 28) discountRate = 0.20;
            else if (effectiveDays > 15) discountRate = 0.08;

            const savings = Math.round(baseCost * discountRate);
            itemTotal = Math.round(baseCost - savings);
            planTitle = `Custom ${effectiveDays}-Day Tiffin Program`;
        }

        // 4. Logistics & Delivery Charges
        const chargesConfig = await getDeliveryConfig(parsedAddress, vendor._id);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let distance = 0;
        if (vendor.location?.lat && vendor.location?.lng) {
            distance = calculateDistance(targetLat, targetLng, Number(vendor.location.lat), Number(vendor.location.lng));
        }

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // 5. Coupon Verification
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

        const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge);
        const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
        const totalAmount = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + taxAmount);

        const effectiveDays = Number(durationDays) || (billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : 7));
        const { startDate, endDate } = calculateSubscriptionDates(billingCycle, effectiveDays);

        res.json({
            success: true,
            planName: planTitle,
            bookingType,
            billingCycle,
            durationDays: effectiveDays,
            distance: `${distance} km`,
            assignedVendor: {
                _id: vendor._id,
                name: vendor.name,
                city: vendor.city,
                address: vendor.address
            },
            dates: {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0]
            },
            universalDeliveryTimes: {
                breakfastTime: universalDeliveryTimes.breakfastTime || "08:00 AM - 09:00 AM",
                lunchTime: universalDeliveryTimes.lunchTime || "01:00 PM - 02:00 PM",
                dinnerTime: universalDeliveryTimes.dinnerTime || "08:00 PM - 09:00 PM"
            },
            billSummary: {
                itemTotal: Math.round(itemTotal),
                deliveryCharge: Math.round(deliveryCharge),
                packagingCharge: Math.round(packagingCharge),
                taxAmount: Math.round(taxAmount),
                taxPercentage,
                couponDiscount: Math.round(couponDiscount),
                couponId: validCouponId,
                totalAmount: Math.round(totalAmount)
            },
            totalConfiguredMeals: verifiedSchedule.length,
            dailyMealSchedule: verifiedSchedule
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 2. DIRECT SUBSCRIBE & BUY TIFFIN (POST /subscribe)
// Direct Purchase -> Initiates Order Immediately
// ==========================================
const subscribeTiffinPlan = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            bookingType = 'Subscription', 
            planId, 
            planName,
            billingCycle = 'weekly', 
            durationDays,
            universalDeliveryTimes = {},
            dailyMealSchedule = [],
            address, 
            userLat,
            userLng,
            couponCode,
            paymentMethod = 'Online'
        } = req.body;

        // Parse address
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        if (!parsedAddress || !parsedAddress.name || !parsedAddress.phone || !parsedAddress.houseNo || !parsedAddress.city) {
            return res.status(400).json({ success: false, message: "Complete delivery address is required to proceed." });
        }

        // 1. Resolve Kitchen Vendor
        const targetLat = Number(userLat || parsedAddress?.lat || parsedAddress?.location?.lat || 30.7046);
        const targetLng = Number(userLng || parsedAddress?.lng || parsedAddress?.location?.lng || 76.7179);

        const vendor = await resolveNearestVendor(foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active kitchen vendor available to service this subscription." });
        }

        // 2. Validate COD Policy
        if (paymentMethod === 'COD') {
            const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
            if (codSetting && codSetting.isCodAvailable === false) {
                return res.status(400).json({ success: false, message: "Cash on Delivery is currently disabled for tiffin subscriptions." });
            }
        }

        // 3. Verify Scheduled Meals
        const verifiedSchedule = [];
        let sumOfSchedule = 0;

        for (let item of dailyMealSchedule) {
            const { weekNumber = 1, dayOfWeek, slotName, mealId } = item;
            if (!dayOfWeek || !slotName || !mealId) continue;

            const dish = await FoodService.findById(mealId);
            if (!dish) throw new Error(`Dish not found: ${mealId}`);

            const dishPrice = dish.discountPrice > 0 ? dish.discountPrice : dish.price;
            sumOfSchedule += dishPrice;

            let slotTime = "01:00 PM - 02:00 PM";
            if (slotName.toLowerCase() === 'breakfast') slotTime = universalDeliveryTimes.breakfastTime || "08:00 AM - 09:00 AM";
            else if (slotName.toLowerCase() === 'lunch') slotTime = universalDeliveryTimes.lunchTime || "01:00 PM - 02:00 PM";
            else if (slotName.toLowerCase() === 'dinner') slotTime = universalDeliveryTimes.dinnerTime || "08:00 PM - 09:00 PM";

            verifiedSchedule.push({
                weekNumber: Number(weekNumber) || 1,
                dayOfWeek: dayOfWeek.toLowerCase(),
                slotName: slotName.toLowerCase(),
                mealId: dish._id,
                mealName: dish.name,
                mealImage: dish.imageUrl,
                mealPrice: dishPrice,
                calories: dish.calories,
                dietType: dish.dietType,
                deliveryTime: slotTime
            });
        }

        if (verifiedSchedule.length === 0) {
            return res.status(400).json({ success: false, message: "Daily meal schedule cannot be empty." });
        }

        // 4. Calculate Price
        let itemTotal = 0;
        let resolvedTitle = planName || "Custom Tiffin Plan";

        if (bookingType === 'Subscription' && planId) {
            const masterPlan = await TiffinPlan.findOne({ $or: [{ _id: planId }, { planId }], isActive: true });
            if (masterPlan) {
                itemTotal = masterPlan.price;
                resolvedTitle = masterPlan.name;
            }
        } else {
            const effectiveDays = Number(durationDays) || (billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : 15));
            const scheduleDaysCount = Math.max(1, new Set(verifiedSchedule.map(s => `${s.weekNumber}-${s.dayOfWeek}`)).size);
            const avgDailyCost = sumOfSchedule / scheduleDaysCount;
            const baseCost = Math.round(avgDailyCost * effectiveDays);

            let discountRate = billingCycle === 'weekly' ? 0.10 : (billingCycle === 'monthly' ? 0.20 : 0.08);
            itemTotal = Math.round(baseCost - (baseCost * discountRate));
            resolvedTitle = `Custom ${effectiveDays}-Day Tiffin Program`;
        }

        // 5. Logistics & Bill
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

        const taxAmount = Math.round(((itemTotal - couponDiscount) + deliveryCharge + packagingCharge) * (taxPercentage / 100));
        const totalAmount = Math.round((itemTotal - couponDiscount) + deliveryCharge + packagingCharge + taxAmount);

        const effectiveDays = Number(durationDays) || (billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : 7));
        const { startDate, endDate } = calculateSubscriptionDates(billingCycle, effectiveDays);

        const tempBookingId = `SUB-FD-${Math.floor(100000 + Math.random() * 900000)}`;
        const deliveryOTP = String(Math.floor(1000 + Math.random() * 9000));

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(totalAmount, `tiffin_${tempBookingId}_${Date.now()}`);
        }

        // 6. Direct Subscription Document Creation
        const newSubscription = await FoodBooking.create({
            bookingId: tempBookingId,
            userId,
            foodId: vendor._id,
            bookingType,
            subscriptionDetails: {
                planId: String(planId || 'custom-plan'),
                planName: resolvedTitle,
                billingCycle: billingCycle.toLowerCase(),
                durationDays: effectiveDays,
                startDate,
                endDate,
                universalDeliveryTimes: {
                    breakfastTime: universalDeliveryTimes.breakfastTime || "08:00 AM - 09:00 AM",
                    lunchTime: universalDeliveryTimes.lunchTime || "01:00 PM - 02:00 PM",
                    dinnerTime: universalDeliveryTimes.dinnerTime || "08:00 PM - 09:00 PM"
                },
                dailyMealSchedule: verifiedSchedule
            },
            collectionType: 'Home Delivery',
            address: parsedAddress,
            billSummary: {
                itemTotal,
                deliveryCharge,
                packagingCharge,
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                totalAmount
            },
            status: 'New',
            paymentMethod,
            paymentStatus: 'Pending',
            deliveryOTP,
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        // COD Flow Output
        if (paymentMethod === 'COD') {
            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: "Tiffin Subscription initiated successfully (COD)!",
                data: newSubscription
            });
        }

        // Online Razorpay Flow Output
        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: "Razorpay order generated for Tiffin Subscription.",
            key: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: totalAmount,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: newSubscription.bookingId,
            subscriptionId: newSubscription._id,
            data: newSubscription
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⏰ 3. MODIFY DAILY SUBSCRIPTION SLOT SCHEDULE (4-HOUR LOCKOUT)
// Full Path: PUT /api/food/tiffin/schedule/:bookingId
// ==========================================
const modifyTiffinSlotSchedule = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.params;
        const { weekNumber = 1, dayOfWeek, slotName, mealId, deliveryTime } = req.body;

        if (!dayOfWeek || !slotName || !mealId) {
            return res.status(400).json({ success: false, message: "dayOfWeek, slotName and new mealId are required." });
        }

        const subscription = await FoodBooking.findOne({
            $or: [{ _id: bookingId }, { bookingId }],
            userId
        });

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription record not found." });
        }

        // 4-Hour Lockout Buffer
        if (deliveryTime) {
            const timeMatch = deliveryTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
            if (timeMatch) {
                let [_, hrs, mins, meridiem] = timeMatch;
                hrs = Number(hrs);
                if (meridiem.toUpperCase() === 'PM' && hrs < 12) hrs += 12;
                if (meridiem.toUpperCase() === 'AM' && hrs === 12) hrs = 0;

                const targetTime = new Date();
                targetTime.setHours(hrs, Number(mins), 0, 0);

                const now = new Date();
                const timeDiffInHours = (targetTime - now) / (1000 * 60 * 60);

                if (timeDiffInHours > 0 && timeDiffInHours < 4) {
                    return res.status(400).json({
                        success: false,
                        message: "Fulfillment lockout active: Changes to same-day delivery profiles are locked 4 hours prior to prep."
                    });
                }
            }
        }

        const newDish = await FoodService.findById(mealId);
        if (!newDish) return res.status(404).json({ success: false, message: "New meal not found." });

        const scheduleIndex = subscription.subscriptionDetails.dailyMealSchedule.findIndex(
            s => s.weekNumber === Number(weekNumber) &&
                 s.dayOfWeek.toLowerCase() === dayOfWeek.toLowerCase() &&
                 s.slotName.toLowerCase() === slotName.toLowerCase()
        );

        if (scheduleIndex !== -1) {
            subscription.subscriptionDetails.dailyMealSchedule[scheduleIndex].mealId = newDish._id;
            subscription.subscriptionDetails.dailyMealSchedule[scheduleIndex].mealName = newDish.name;
            subscription.subscriptionDetails.dailyMealSchedule[scheduleIndex].mealImage = newDish.imageUrl;
            subscription.subscriptionDetails.dailyMealSchedule[scheduleIndex].mealPrice = newDish.discountPrice > 0 ? newDish.discountPrice : newDish.price;
            if (deliveryTime) {
                subscription.subscriptionDetails.dailyMealSchedule[scheduleIndex].deliveryTime = deliveryTime;
            }
        } else {
            subscription.subscriptionDetails.dailyMealSchedule.push({
                weekNumber: Number(weekNumber),
                dayOfWeek: dayOfWeek.toLowerCase(),
                slotName: slotName.toLowerCase(),
                mealId: newDish._id,
                mealName: newDish.name,
                mealImage: newDish.imageUrl,
                mealPrice: newDish.discountPrice > 0 ? newDish.discountPrice : newDish.price,
                calories: newDish.calories,
                dietType: newDish.dietType,
                deliveryTime: deliveryTime || "01:00 PM - 02:00 PM"
            });
        }

        await subscription.save();

        res.json({
            success: true,
            message: `Meal for ${dayOfWeek} (${slotName}) updated successfully!`,
            dailyMealSchedule: subscription.subscriptionDetails.dailyMealSchedule
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 4. GET ACTIVE TIFFIN SUBSCRIPTION FULL DETAILS
// Full Path: GET /api/food/tiffin/my-subscription/:bookingId
// ==========================================
const getMyTiffinSubscriptionDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.params;

        const subscription = await FoodBooking.findOne({
            $or: [{ _id: bookingId }, { bookingId }],
            userId
        })
        .populate('foodId', 'name profileImage address city phone')
        .populate('subscriptionDetails.dailyMealSchedule.mealId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .lean();

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription not found." });
        }

        res.json({
            success: true,
            data: subscription
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateTiffinSubscriptionBill,
    subscribeTiffinPlan,
    modifyTiffinSlotSchedule,
    getMyTiffinSubscriptionDetails
};