// controllers/user/Food/UserHealthyPlanOrder.js

const FoodBooking = require('../../../models/FoodBooking');
const FoodHealthyPlans = require('../../../models/FoodHealthyPlans');
const VendorHealthyPlan = require('../../../models/VendorHealthyPlan');
const Food = require('../../../models/Food');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const PeakOrderCharge = require('../../../models/PeakOrderCharge');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const Cart = require('../../../models/Cart');

const crypto = require('crypto');
const mongoose = require('mongoose'); 
const { getDistance } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay');

// ==========================================
// 💡 HELPER: AUTO-RESOLVE NEAREST KITCHEN FOR HEALTHY PLAN
// ==========================================
const resolveNearestKitchenForPlan = async (healthyPlanId, passedFoodId, userLat, userLng) => {
    // 1. If explicit kitchen passed
    if (passedFoodId) {
        const vendor = await Food.findById(passedFoodId);
        if (vendor && vendor.profileStatus === 'Approved' && vendor.isActive && vendor.isOnline) {
            const mapping = await VendorHealthyPlan.findOne({ vendorId: vendor._id, healthyPlanId, isAvailable: true });
            if (mapping) {
                let dist = 0;
                if (userLat && userLng && vendor.location?.lat && vendor.location?.lng) {
                    dist = await getDistance(Number(userLat), Number(userLng), Number(vendor.location.lat), Number(vendor.location.lng));
                }
                return { vendor, distance: dist };
            }
        }
    }

    // 2. Resolve nearest kitchen that has enabled this healthy plan
    const activeMappings = await VendorHealthyPlan.find({ healthyPlanId, isAvailable: true }).select('vendorId').lean();
    const vendorIds = activeMappings.map(m => m.vendorId);

    const vendors = await Food.find({
        _id: { $in: vendorIds },
        profileStatus: 'Approved',
        isActive: true,
        isOnline: true
    }).lean();

    let nearestVendor = null;
    let minDistance = Infinity;

    for (let v of vendors) {
        if (!v.location?.lat || !v.location?.lng) continue;
        const dist = await getDistance(Number(userLat), Number(userLng), Number(v.location.lat), Number(v.location.lng));
        if (dist < minDistance) {
            minDistance = dist;
            nearestVendor = v;
        }
    }

    if (nearestVendor) {
        return { vendor: nearestVendor, distance: minDistance };
    }

    // Fallback: First active vendor serving this plan
    const fallbackVendor = vendors[0] || await Food.findOne({ profileStatus: 'Approved', isActive: true, isOnline: true });
    return { vendor: fallbackVendor, distance: 0 };
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
// 💡 HELPER: PEAK SURCHARGE CALCULATOR
// ==========================================
const calculateSlotPeakCharge = async (programType) => {
    const peakConfig = await PeakOrderCharge.findOne({ vendorType: 'Food' });
    if (!peakConfig || !peakConfig.isGlobalActive) return 0;

    let dailyPeak = 0;
    if (programType === 'Full Program') {
        if (peakConfig.breakfast?.isActive) dailyPeak += Number(peakConfig.breakfast.charge || 0);
        if (peakConfig.lunch?.isActive) dailyPeak += Number(peakConfig.lunch.charge || 0);
        if (peakConfig.dinner?.isActive) dailyPeak += Number(peakConfig.dinner.charge || 0);
    } else if (programType === 'Lunches & Dinners') {
        if (peakConfig.lunch?.isActive) dailyPeak += Number(peakConfig.lunch.charge || 0);
        if (peakConfig.dinner?.isActive) dailyPeak += Number(peakConfig.dinner.charge || 0);
    } else if (programType === 'Breakfast & Lunch') {
        if (peakConfig.breakfast?.isActive) dailyPeak += Number(peakConfig.breakfast.charge || 0);
        if (peakConfig.lunch?.isActive) dailyPeak += Number(peakConfig.lunch.charge || 0);
    }

    return dailyPeak;
};

// ==========================================
// 🧮 1. CALCULATE / PREVIEW HEALTHY PLAN BILL
// Full Path: POST /api/food/healthy-plans/calculate
// ==========================================
const calculateHealthyPlanBill = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            healthyPlanId,
            foodId,
            startAtThisDate, // 👈 🌟 User Defined Custom Start Date
            startDate,       // Fallback
            address,
            userLat = 30.6983,
            userLng = 76.6857,
            couponCode
        } = req.body;

        if (!healthyPlanId) {
            return res.status(400).json({ success: false, message: "healthyPlanId is required." });
        }

        // 1. Fetch Master Healthy Plan
        const plan = await FoodHealthyPlans.findOne({
            $or: [{ _id: healthyPlanId }, { planId: healthyPlanId }],
            isActive: true
        }).lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Selected Healthy Diet Plan is currently unavailable." });
        }

        // 2. Resolve Kitchen Vendor & Distance
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        const targetLat = Number(userLat || parsedAddress?.lat || 30.6983);
        const targetLng = Number(userLng || parsedAddress?.lng || 76.6857);

        const { vendor, distance } = await resolveNearestKitchenForPlan(plan._id, foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active kitchen vendor available in your area for this plan." });
        }

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 10;
        if (distance > maxRadius) {
            return res.status(400).json({
                success: false,
                message: `Your location is ${distance.toFixed(1)} km away. Maximum delivery limit is ${maxRadius} km.`
            });
        }

        // 3. COD Check
        const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
        const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

        // 4. Pricing & Calculations
        const itemTotal = plan.pricing.discountTotalPrice > 0 ? plan.pricing.discountTotalPrice : plan.pricing.totalPrice;
        const totalDays = Number(plan.daysCount || 5);

        const dailyPeak = await calculateSlotPeakCharge(plan.programType);
        const totalPeakCharge = dailyPeak * totalDays;

        const chargesConfig = await getDeliveryConfig(parsedAddress, vendor._id);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // 5. Coupon Verification
        let couponDiscount = 0;
        let validCouponId = null;

        if (couponCode) {
            const cleanCode = String(couponCode).toUpperCase().trim();
            const now = new Date();

            const couponQueryConditions = [
                { isUserSpecific: { $ne: true }, vendorId: vendor._id, vendorType: 'Food' },
                { isUserSpecific: { $ne: true }, isAdminCreated: true, vendorType: { $in: ['Food', 'All'] } }
            ];

            if (userId) {
                couponQueryConditions.push({
                    isUserSpecific: true,
                    assignedUserId: userId,
                    vendorType: { $in: ['Food', 'All'] }
                });
            }

            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                startDate: { $lte: now },
                expiryDate: { $gte: now },
                $or: couponQueryConditions
            });

            if (!coupon) {
                return res.status(400).json({ success: false, message: `Coupon '${cleanCode}' is invalid, expired, or not applicable to your account.` });
            }

            if (coupon.isUserSpecific && coupon.assignedUserId?.toString() !== userId.toString()) {
                return res.status(400).json({ success: false, message: `Coupon '${cleanCode}' is an exclusive voucher and is not valid for your account.` });
            }

            if (itemTotal < (coupon.minOrderAmount || 0)) {
                return res.status(400).json({ success: false, message: `Minimum order amount of ₹${coupon.minOrderAmount} required for coupon '${cleanCode}'.` });
            }

            couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            validCouponId = coupon._id;
        }

        const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakCharge);
        const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
        const grandTotal = Math.max(0, taxableSubtotal + taxAmount);

        // 6. 📅 Dates Calculation using startAtThisDate
        const chosenStartDate = startAtThisDate || startDate;
        const start = chosenStartDate ? new Date(chosenStartDate) : new Date();
        const end = new Date(start);
        end.setDate(start.getDate() + (totalDays - 1));

        res.json({
            success: true,
            planDetails: {
                _id: plan._id,
                planId: plan.planId,
                title: plan.title,
                mainCategory: plan.mainCategory,
                subCategory: plan.subCategory,
                programType: plan.programType,
                daysCount: totalDays,
                dates: {
                    startAtThisDate: start.toISOString().split('T')[0],
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0]
                }
            },
            distance: `${distance.toFixed(1)} km`,
            assignedKitchen: {
                _id: vendor._id,
                name: vendor.name,
                address: vendor.address,
                city: vendor.city,
                rating: vendor.rating || 4.9,
                profileImage: vendor.profileImage
            },
            orderRestrictions: {
                isCodAvailable
            },
            billSummary: {
                itemTotal,
                deliveryCharge,
                packagingCharge,
                peakOrderCharge: totalPeakCharge,
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                totalAmount: grandTotal,
                savingsAmount: plan.pricing?.savingsAmount || 0
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
//  2. SUBSCRIBE / BUY HEALTHY PLAN (FIXED & SECURED)
// Full Path: POST /api/food/healthy-plans/subscribe
// ==========================================
const subscribeHealthyPlanOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            healthyPlanId,
            foodId,
            startAtThisDate, // 👈 User Defined Custom Start Date
            startDate,       // Fallback
            address,
            userLat = 30.6983,
            userLng = 76.6857,
            couponCode,
            paymentMethod = 'Online',
            userNote = "",
            purposeOfBuying = "",
            deliveryTimes = {
                breakfastTime: "08:00 AM - 09:00 AM",
                lunchTime: "01:00 PM - 02:00 PM",
                dinnerTime: "08:00 PM - 09:00 PM"
            }
        } = req.body;

        if (!healthyPlanId) {
            return res.status(400).json({ success: false, message: "healthyPlanId is required." });
        }

        // 1. Safe Address Parsing
        let parsedAddress = address;
        if (typeof address === 'string') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
        }

        if (!parsedAddress || !parsedAddress.name || !parsedAddress.phone || !parsedAddress.houseNo || !parsedAddress.city) {
            return res.status(400).json({ success: false, message: "Complete delivery address with name, phone, houseNo, and city is required." });
        }

        // 2. Safe Delivery Times Parsing
        let parsedDeliveryTimes = deliveryTimes;
        if (typeof deliveryTimes === 'string') {
            try { parsedDeliveryTimes = JSON.parse(deliveryTimes); } catch (e) { parsedDeliveryTimes = {}; }
        }

        const finalDeliveryTimes = {
            breakfastTime: parsedDeliveryTimes?.breakfastTime || "08:00 AM - 09:00 AM",
            lunchTime: parsedDeliveryTimes?.lunchTime || "01:00 PM - 02:00 PM",
            dinnerTime: parsedDeliveryTimes?.dinnerTime || "08:00 PM - 09:00 PM"
        };

        // 3. Fetch Master Plan
        const plan = await FoodHealthyPlans.findOne({
            $or: [{ _id: healthyPlanId }, { planId: healthyPlanId }],
            isActive: true
        }).lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Healthy diet plan not found or currently suspended." });
        }

        // 4. Resolve Nearest Kitchen
        const targetLat = Number(userLat || parsedAddress?.lat || 30.6983);
        const targetLng = Number(userLng || parsedAddress?.lng || 76.6857);

        const { vendor, distance } = await resolveNearestKitchenForPlan(plan._id, foodId, targetLat, targetLng);
        if (!vendor) {
            return res.status(400).json({ success: false, message: "No active cloud kitchen available in your area for this plan." });
        }

        // Distance Radius Limit Check
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 10;
        if (distance > maxRadius) {
            return res.status(400).json({
                success: false,
                message: `Your address is ${distance.toFixed(1)} km away. Maximum delivery radius is ${maxRadius} km.`
            });
        }

        // 5. COD Policy Check
        const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
        const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

        if (paymentMethod === 'COD' && !isCodAvailable) {
            return res.status(400).json({ success: false, message: "Cash on Delivery is currently disabled for healthy plans. Please pay online." });
        }

        // 6. Pricing & Billing Calculation
        const itemTotal = plan.pricing.discountTotalPrice > 0 ? plan.pricing.discountTotalPrice : plan.pricing.totalPrice;
        const totalDays = Number(plan.daysCount || 5);

        const dailyPeak = await calculateSlotPeakCharge(plan.programType);
        const totalPeakCharge = dailyPeak * totalDays;

        const chargesConfig = await getDeliveryConfig(parsedAddress, vendor._id);
        const fixedPrice = chargesConfig.fixedPrice || 40;
        const packagingCharge = chargesConfig.packagingCharge || 15;
        const freeDeliveryThreshold = chargesConfig.freeDeliveryThreshold || 500;
        const taxPercentage = chargesConfig.taxPercentage || 5;

        let deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;

        // 7. Coupon Verification
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
                    { isUserSpecific: { $ne: true }, vendorId: vendor._id, vendorType: 'Food' },
                    { isUserSpecific: { $ne: true }, isAdminCreated: true, vendorType: { $in: ['Food', 'All'] } },
                    { isUserSpecific: true, assignedUserId: userId, vendorType: { $in: ['Food', 'All'] } }
                ]
            });

            if (coupon && itemTotal >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                validCouponId = coupon._id;
            }
        }

        const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + totalPeakCharge);
        const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
        const grandTotal = Math.round(taxableSubtotal + taxAmount);

        // 8. 📅 Start and End Dates Validation
        const chosenStartDate = startAtThisDate || startDate;
        const start = chosenStartDate ? new Date(chosenStartDate) : new Date();

        if (isNaN(start.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid date format for startAtThisDate. Please use YYYY-MM-DD." });
        }

        const end = new Date(start);
        end.setDate(start.getDate() + (totalDays - 1));

        const tempBookingId = `HLP-ORD-${Math.floor(100000 + Math.random() * 900000)}`;
        const deliveryOTP = String(Math.floor(1000 + Math.random() * 9000));

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(grandTotal, `hlp_${tempBookingId}_${Date.now()}`);
        }

        // 9. 🚨 FIXED STATUS: COD -> 'Active' | Online -> 'New' (Matches Enum)
        const initialStatus = paymentMethod === 'COD' ? 'Active' : 'New';

        // 10. Create Booking Document in MongoDB
        const newBooking = await FoodBooking.create({
            bookingId: tempBookingId,
            userId,
            foodId: vendor._id,
            bookingType: 'Healthy Plan',
            healthyPlanDetails: {
                healthyPlanId: plan._id,
                planId: plan.planId,
                title: plan.title,
                mainCategory: plan.mainCategory,
                subCategory: plan.subCategory,
                programType: plan.programType,
                daysCount: totalDays,
                startAtThisDate: start,
                startDate: start,
                endDate: end,
                isRepeatAfter7Days: plan.isRepeatAfter7Days,
                userNote: userNote ? String(userNote).trim() : "",
                purposeOfBuying: purposeOfBuying ? String(purposeOfBuying).trim() : "",
                deliveryTimes: finalDeliveryTimes,
                dayWiseSchedule: plan.dayWiseSchedule || []
            },
            collectionType: 'Home Delivery',
            address: parsedAddress,
            billSummary: {
                itemTotal,
                deliveryCharge,
                packagingCharge,
                peakOrderCharge: totalPeakCharge,
                taxAmount,
                taxPercentage,
                couponDiscount,
                couponId: validCouponId,
                totalAmount: grandTotal
            },
            status: initialStatus, // 👈 Fixed Enum Value
            paymentMethod,
            paymentStatus: 'Pending',
            deliveryOTP,
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        // COD Success Response
        if (paymentMethod === 'COD') {
            if (validCouponId) {
                await Coupon.findByIdAndUpdate(validCouponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: `Healthy Diet Plan '${plan.title}' activated successfully (COD)! Starts on ${start.toISOString().split('T')[0]}`,
                data: newBooking
            });
        }

        // Online Payment Razorpay Response
        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: `Razorpay order generated for Healthy Diet Plan subscription.`,
            key: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: grandTotal,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: newBooking.bookingId,
            orderId: newBooking._id,
            data: newBooking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 3. VERIFY PAYMENT (FIXED 500 CAST ERROR & KEY MAPPINGS)
// Full Path: POST /api/food/healthy-plans/verify-payment
// ==========================================
const verifyHealthyPlanPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            bookingId,
            orderId,
            id,
            appointmentId,
            razorpayOrderId,
            razorpay_order_id,
            razorpayPaymentId,
            razorpay_payment_id,
            razorpaySignature,
            razorpay_signature
        } = req.body;

        // 1. Safe Token & Key Resolutions (Handles both camelCase & snake_case)
        const targetId = bookingId || orderId || appointmentId || id;
        const rzpOrderId = razorpayOrderId || razorpay_order_id;
        const rzpPaymentId = razorpayPaymentId || razorpay_payment_id;
        const rzpSignature = razorpaySignature || razorpay_signature;

        if (!targetId || !rzpOrderId || !rzpPaymentId || !rzpSignature) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing payment verification parameters (bookingId/orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature are required)." 
            });
        }

        // 2. Signature Verification
        let isVerified = false;
        try {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        } catch (e) {
            const secret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/["']/g, "").trim();
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(`${rzpOrderId}|${rzpPaymentId}`)
                .digest('hex');
            isVerified = (expectedSignature === rzpSignature);
        }

        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed." });
        }

        // 3. 🛡️ Safe Query Builder (Prevents Cast to ObjectId 500 error)
        const queryConditions = [
            { bookingId: targetId },
            { "paymentDetails.razorpayOrderId": rzpOrderId }
        ];

        if (mongoose.Types.ObjectId.isValid(targetId)) {
            queryConditions.push({ _id: targetId });
        }

        const order = await FoodBooking.findOne({
            $or: queryConditions,
            userId,
            bookingType: 'Healthy Plan'
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Healthy Plan order not found with the provided booking ID." 
            });
        }

        // 4. Fetch Authentic Payment Details from Razorpay (Fallback safe)
        let rzpDetails = null;
        try {
            rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
        } catch (e) {
            rzpDetails = null;
        }

        // 5. Direct Activation
        order.status = 'Active';
        order.paymentStatus = 'Paid';
        order.paymentMethod = 'Online';
        order.paymentDetails = rzpDetails || {
            razorpayPaymentId: rzpPaymentId,
            razorpayOrderId: rzpOrderId,
            razorpaySignature: rzpSignature,
            paidAt: new Date()
        };

        await order.save();

        // 6. Record Coupon Usage (if applied)
        if (order.billSummary?.couponId) {
            await Coupon.findByIdAndUpdate(order.billSummary.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        res.json({
            success: true,
            message: "Payment verified successfully & Healthy Diet Plan is now Active!",
            data: {
                bookingId: order.bookingId,
                status: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                healthyPlanDetails: {
                    title: order.healthyPlanDetails?.title,
                    startDate: order.healthyPlanDetails?.startDate,
                    endDate: order.healthyPlanDetails?.endDate,
                    startAtThisDate: order.healthyPlanDetails?.startAtThisDate
                },
                billSummary: order.billSummary,
                updatedAt: order.updatedAt
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 5.1 GET ALL MY HEALTHY PLAN ORDERS (User Order History List)
// Full Path: GET /api/food/healthy-plans/my-plans
// ==========================================
const getMyHealthyPlanOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status } = req.query;

        // Strictly queries user's Healthy Plan bookings from FoodBooking collection
        const query = {
            userId,
            bookingType: 'Healthy Plan'
        };

        if (status) query.status = status;

        // Lightweight card fields projection
        const orders = await FoodBooking.find(query)
            .select('_id bookingId status bookingType healthyPlanDetails billSummary.totalAmount foodId paymentStatus createdAt')
            .populate('foodId', 'name profileImage city address phone')
            .sort({ createdAt: -1 })
            .lean();

        // 🛡️ Format Clean Snapshot List (Never breaks even if master plan is soft-deleted)
        const cleanList = orders.map(order => {
            const h = order.healthyPlanDetails || {};
            const startAt = h.startAtThisDate || h.startDate;
            const end = h.endDate;

            return {
                _id: order._id,
                bookingId: order.bookingId,
                bookingType: "Healthy Plan",
                title: h.title || "Healthy Diet Plan",
                planId: h.planId || "HLP-101",
                mainCategory: h.mainCategory || "General",
                subCategory: h.subCategory || "Diet Program",
                programType: h.programType || "Full Program",
                daysCount: h.daysCount || 1,
                status: order.status,
                paymentStatus: order.paymentStatus,
                totalAmount: order.billSummary?.totalAmount || 0,
                startAtThisDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: end ? new Date(end).toISOString().split('T')[0] : null,
                kitchen: {
                    _id: order.foodId?._id,
                    name: order.foodId?.name || "Healthy Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    profileImage: order.foodId?.profileImage || null
                },
                createdAt: order.createdAt
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

// ==========================================
// 🔍 5.2 GET SINGLE HEALTHY PLAN ORDER FULL DETAILS BY ID
// Full Path: GET /api/food/healthy-plans/my-plan/:id
// ==========================================
const getMyHealthyPlanOrderById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Queries the specific order record by MongoDB _id or custom bookingId
        const order = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            userId,
            bookingType: 'Healthy Plan'
        })
        .populate('foodId', 'name profileImage address city phone rating location')
        .populate({
            path: 'healthyPlanDetails.dayWiseSchedule.breakfast healthyPlanDetails.dayWiseSchedule.lunch healthyPlanDetails.dayWiseSchedule.dinner',
            select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags glycemicIndex netCarbs sodium',
            strictPopulate: false
        })
        .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Healthy Diet Plan order details not found." 
            });
        }

        // 🧹 Clean Data Sanitization (Removes irrelevant empty sub-schemas)
        delete order.subscriptionDetails;
        delete order.customTiffinDetails;
        delete order.items;
        delete order.addons;

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateHealthyPlanBill,
    subscribeHealthyPlanOrder,
    verifyHealthyPlanPayment,
    getMyHealthyPlanOrders,
    getMyHealthyPlanOrderById
};