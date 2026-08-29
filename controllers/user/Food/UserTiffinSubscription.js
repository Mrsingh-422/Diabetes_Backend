// controllers/user/Food/UserTiffinSubscriptionController.js

const FoodBooking = require('../../../models/FoodBooking');
const TiffinPlan = require('../../../models/TiffinPlan');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const Food = require('../../../models/Food');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const Cart = require('../../../models/Cart');

const { createRazorpayOrder } = require('../../../utils/razorpay');

// ==========================================
// 💡 HELPER: CALCULATE SUBSCRIPTION DATES
// ==========================================
const calculateDates = (cycle, daysMultiplier = null, customStartDate = null) => {
    const startDate = customStartDate ? new Date(customStartDate) : new Date();
    const endDate = new Date(startDate);

    if (cycle === 'weekly' || cycle === 'Weekly Cycle') {
        endDate.setDate(startDate.getDate() + 7);
    } else if (cycle === 'monthly' || cycle === 'Monthly Cycle') {
        endDate.setDate(startDate.getDate() + 30);
    } else if (daysMultiplier) {
        endDate.setDate(startDate.getDate() + Number(daysMultiplier));
    } else {
        endDate.setDate(startDate.getDate() + 30);
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
// 🧮 1. CALCULATE TIFFIN SUBSCRIPTION BILL (PREVIEW)
// Full Path: POST /api/food/tiffin/calculate
// ==========================================
const calculateTiffinSubscriptionBill = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            bookingType = 'Subscription', // 'Subscription' ya 'Custom Plate'
            planId, 
            billingCycle = 'monthly', 
            daysMultiplier,
            slotsConfiguration = [], 
            customPlateSchedule = [],
            address, 
            couponCode 
        } = req.body;

        if (!foodId) {
            return res.status(400).json({ success: false, message: "Kitchen Vendor ID (foodId) is required." });
        }

        let itemTotal = 0;
        let verifiedSlots = [];
        let verifiedCustomSchedule = [];

        // ----------------------------------------------------
        // SCENARIO A: PRE-SET MASTER PLAN (OurTiffin Model)
        // ----------------------------------------------------
        if (bookingType === 'Subscription') {
            if (!planId) {
                return res.status(400).json({ success: false, message: "planId is required for standard tiffin subscriptions." });
            }

            const masterPlan = await TiffinPlan.findOne({
                $or: [{ _id: planId }, { planId }],
                isActive: true
            });

            if (!masterPlan) {
                return res.status(404).json({ success: false, message: "Selected Tiffin Plan is currently unavailable." });
            }

            // Slot Quota Validation: Ensure selected slots match plan limit
            if (slotsConfiguration.length !== masterPlan.mealsPerDay) {
                return res.status(422).json({
                    success: false,
                    message: `Validation Error: This plan tier (${masterPlan.name}) requires exactly ${masterPlan.mealsPerDay} active meal slot(s). You configured ${slotsConfiguration.length}.`
                });
            }

            itemTotal = masterPlan.price;

            // Verify each configured dish
            for (let slot of slotsConfiguration) {
                const { slotName, mealId, preferredTime } = slot;
                const dish = await FoodService.findById(mealId).select('name price discountPrice imageUrl dietType calories');
                
                if (!dish) {
                    throw new Error(`Dish with ID '${mealId}' configured in slot '${slotName}' was not found.`);
                }

                verifiedSlots.push({
                    slotName: slotName.toLowerCase(),
                    mealId: dish._id,
                    mealName: dish.name,
                    mealImage: dish.imageUrl,
                    calories: dish.calories,
                    dietType: dish.dietType,
                    preferredTime: preferredTime || (slotName.toLowerCase() === 'breakfast' ? '08:30' : (slotName.toLowerCase() === 'lunch' ? '13:00' : '20:00'))
                });
            }
        } 
        // ----------------------------------------------------
        // SCENARIO B: CUSTOM 7-DAY WORKSPACE (Custom Plate)
        // ----------------------------------------------------
        else if (bookingType === 'Custom Plate') {
            if (!Array.isArray(customPlateSchedule) || customPlateSchedule.length === 0) {
                return res.status(400).json({ success: false, message: "customPlateSchedule array is required for custom plate bookings." });
            }

            let weeklyTotal = 0;

            for (let item of customPlateSchedule) {
                const { dayOfWeek, slotName, mealId, preferredTime } = item;
                const dish = await FoodService.findById(mealId).select('name price discountPrice imageUrl dietType calories');

                if (!dish) {
                    throw new Error(`Dish with ID '${mealId}' for ${dayOfWeek} ${slotName} not found.`);
                }

                const price = dish.discountPrice > 0 ? dish.discountPrice : dish.price;
                weeklyTotal += price;

                verifiedCustomSchedule.push({
                    dayOfWeek: dayOfWeek.toLowerCase(),
                    slotName: slotName.toLowerCase(),
                    mealId: dish._id,
                    mealName: dish.name,
                    mealImage: dish.imageUrl,
                    mealPrice: price,
                    calories: dish.calories,
                    dietType: dish.dietType,
                    preferredTime: preferredTime || '13:00'
                });
            }

            // Pricing Math: Average Daily Cost * multiplier - Discount
            const multiplier = billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : Number(daysMultiplier || 30));
            const averageDailyPrice = weeklyTotal / 7;
            const baseProgramCost = Math.round(averageDailyPrice * multiplier);

            let discountRate = 0;
            if (billingCycle === 'weekly') discountRate = 0.10; // 10%
            else if (billingCycle === 'monthly') discountRate = 0.20; // 20%
            else if (billingCycle === 'custom' && multiplier > 15) discountRate = 0.08; // 8%

            const planSavings = Math.round(baseProgramCost * discountRate);
            itemTotal = Math.round(baseProgramCost - planSavings);
        }

        // Logistics & Delivery Charges
        const chargesConfig = await getDeliveryConfig(address, foodId);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // Coupon Verification
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
                    { vendorId: foodId, vendorType: 'Food' },
                    { isAdminCreated: true, vendorType: { $in: ['Food', 'All'] } }
                ]
            });

            if (coupon && itemTotal >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                validCouponId = coupon._id;
            }
        }

        // Tax & Total Assessment
        const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge);
        const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
        const totalAmount = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + taxAmount);

        // Calculate Dates Preview
        const { startDate, endDate } = calculateDates(billingCycle, daysMultiplier);

        res.json({
            success: true,
            bookingType,
            billingCycle,
            dates: {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0]
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
            slotsConfiguration: verifiedSlots,
            customPlateSchedule: verifiedCustomSchedule
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 2. PURCHASE & SUBSCRIBE TIFFIN (ORDER PLACEMENT)
// Full Path: POST /api/food/tiffin/subscribe
// ==========================================
const subscribeTiffinPlan = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            bookingType = 'Subscription', 
            planId, 
            billingCycle = 'monthly', 
            daysMultiplier,
            slotsConfiguration = [], 
            customPlateSchedule = [],
            address, 
            couponCode,
            paymentMethod = 'Online'
        } = req.body;

        // Parse address
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        if (!parsedAddress || !parsedAddress.name || !parsedAddress.phone || !parsedAddress.houseNo || !parsedAddress.city) {
            return res.status(400).json({ success: false, message: "Complete delivery address is required." });
        }

        // Verify Kitchen
        const vendor = await Food.findById(foodId);
        if (!vendor || !vendor.isActive || vendor.isOnline === false) {
            return res.status(400).json({ success: false, message: "Kitchen vendor is currently offline or unavailable." });
        }

        // Validate COD Policy
        if (paymentMethod === 'COD') {
            const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
            if (codSetting && codSetting.isCodAvailable === false) {
                return res.status(400).json({ success: false, message: "Cash on Delivery is currently disabled for tiffin subscriptions." });
            }
        }

        // Calculate Pricing using helper logic
        let itemTotal = 0;
        let verifiedSlots = [];
        let verifiedCustom = [];

        if (bookingType === 'Subscription') {
            const masterPlan = await TiffinPlan.findOne({ $or: [{ _id: planId }, { planId }], isActive: true });
            if (!masterPlan) return res.status(404).json({ success: false, message: "Tiffin Plan not found." });

            if (slotsConfiguration.length !== masterPlan.mealsPerDay) {
                return res.status(422).json({
                    success: false,
                    message: `Validation Error: This plan requires exactly ${masterPlan.mealsPerDay} configured slot(s).`
                });
            }

            itemTotal = masterPlan.price;
            for (let slot of slotsConfiguration) {
                const dish = await FoodService.findById(slot.mealId);
                if (!dish) throw new Error(`Dish not found: ${slot.mealId}`);

                verifiedSlots.push({
                    slotName: slot.slotName.toLowerCase(),
                    mealId: dish._id,
                    preferredTime: slot.preferredTime || '13:00'
                });
            }
        } else {
            let weeklyTotal = 0;
            for (let item of customPlateSchedule) {
                const dish = await FoodService.findById(item.mealId);
                if (!dish) throw new Error(`Dish not found: ${item.mealId}`);

                const price = dish.discountPrice > 0 ? dish.discountPrice : dish.price;
                weeklyTotal += price;

                verifiedCustom.push({
                    dayOfWeek: item.dayOfWeek.toLowerCase(),
                    slotName: item.slotName.toLowerCase(),
                    baseIngredientId: item.baseIngredientId || null,
                    proteinIngredientId: item.proteinIngredientId || null,
                    fiberIngredientId: item.fiberIngredientId || null,
                    preferredDeliveryTime: item.preferredTime || '13:00'
                });
            }

            const multiplier = billingCycle === 'weekly' ? 7 : (billingCycle === 'monthly' ? 30 : Number(daysMultiplier || 30));
            const averageDailyPrice = weeklyTotal / 7;
            const baseProgramCost = Math.round(averageDailyPrice * multiplier);
            let discountRate = billingCycle === 'weekly' ? 0.10 : (billingCycle === 'monthly' ? 0.20 : 0.08);
            itemTotal = Math.round(baseProgramCost - (baseProgramCost * discountRate));
        }

        // Logistics & Bill
        const chargesConfig = await getDeliveryConfig(parsedAddress, foodId);
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

        // Dates
        const { startDate, endDate } = calculateDates(billingCycle, daysMultiplier);

        const tempBookingId = `SUB-FD-${Math.floor(100000 + Math.random() * 900000)}`;
        const deliveryOTP = String(Math.floor(1000 + Math.random() * 9000));

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(totalAmount, `tiffin_${tempBookingId}_${Date.now()}`);
        }

        // Create Database Booking Document
        const newSubscription = await FoodBooking.create({
            bookingId: tempBookingId,
            userId,
            foodId,
            bookingType,
            subscriptionDetails: {
                planId: String(planId || 'custom-plan'),
                billingCycle: billingCycle.toLowerCase(),
                startDate,
                endDate,
                slotsConfiguration: verifiedSlots
            },
            customPlateSchedule: verifiedCustom,
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

        // COD Immediate Confirmation
        if (paymentMethod === 'COD') {
            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: "Tiffin Subscription initiated successfully (COD)!",
                data: newSubscription
            });
        }

        // Online Razorpay Initiation
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
// ⏰ 3. MODIFY DAILY SUBSCRIPTION SLOT SCHEDULE (WITH 4-HOUR LOCKOUT)
// Full Path: PUT /api/food/tiffin/schedule/:bookingId
// ==========================================
const modifyTiffinSlotSchedule = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.params;
        const { slotName, mealId, preferredTime } = req.body;

        if (!slotName || !mealId) {
            return res.status(400).json({ success: false, message: "slotName and new mealId are required." });
        }

        const subscription = await FoodBooking.findOne({
            $or: [{ _id: bookingId }, { bookingId }],
            userId
        });

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        // 🚨 4-HOUR FULFILLMENT LOCKOUT BUFFER CHECK
        if (preferredTime) {
            const [hours, minutes] = preferredTime.split(':');
            const targetTime = new Date();
            targetTime.setHours(Number(hours), Number(minutes), 0, 0);

            const now = new Date();
            const timeDiffInHours = (targetTime - now) / (1000 * 60 * 60);

            if (timeDiffInHours > 0 && timeDiffInHours < 4) {
                return res.status(400).json({
                    success: false,
                    message: "Fulfillment lockout active: Changes to same-day delivery profiles are locked 4 hours prior to prep."
                });
            }
        }

        // Update Slot
        const slotIndex = subscription.subscriptionDetails.slotsConfiguration.findIndex(
            s => s.slotName.toLowerCase() === slotName.toLowerCase()
        );

        if (slotIndex !== -1) {
            subscription.subscriptionDetails.slotsConfiguration[slotIndex].mealId = mealId;
            if (preferredTime) {
                subscription.subscriptionDetails.slotsConfiguration[slotIndex].preferredTime = preferredTime;
            }
        } else {
            subscription.subscriptionDetails.slotsConfiguration.push({
                slotName: slotName.toLowerCase(),
                mealId,
                preferredTime: preferredTime || '13:00'
            });
        }

        await subscription.save();

        res.json({
            success: true,
            message: `Delivery schedule for '${slotName}' updated successfully!`,
            slotsConfiguration: subscription.subscriptionDetails.slotsConfiguration
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 4. GET MY ACTIVE TIFFIN SUBSCRIPTION DETAILS
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
        .populate('subscriptionDetails.slotsConfiguration.mealId', 'name imageUrl price discountPrice calories dietType')
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