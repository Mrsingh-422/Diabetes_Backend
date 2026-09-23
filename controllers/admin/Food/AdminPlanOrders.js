// controllers/admin/Food/AdminPlanOrdersController.js

const FoodBooking = require('../../../models/FoodBooking');
const FoodHealthyPlans = require('../../../models/FoodHealthyPlans');
const TiffinPlan = require('../../../models/TiffinPlan');
const mongoose = require('mongoose');

// Helper to safely parse array fields
const parseArray = (field) => {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
        try {
            const parsed = JSON.parse(field);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            return field.split(',').map(item => item.trim()).filter(Boolean);
        }
    }
    return [];
};

// =========================================================================
// 🥗 GROUP 1: HEALTHY PLANS (PLANS LIST & PLAN WITH SUBSCRIBED USERS)
// =========================================================================

// --- 1.1 GET ALL HEALTHY PLANS (WITH DYNAMIC SUBSCRIBER COUNTS) ---
// Full Path: GET /admin/food/plan-orders/healthy-plans
const getAdminHealthyPlanOrdersList = async (req, res) => {
    try {
        const { mainCategory, subCategory, programType, daysCount, search, page = 1, limit = 20 } = req.query;

        const query = {};
        if (mainCategory) query.mainCategory = new RegExp(`^${mainCategory.trim()}$`, 'i');
        if (subCategory) query.subCategory = new RegExp(`^${subCategory.trim()}$`, 'i');
        if (programType) query.programType = programType;
        if (daysCount) query.daysCount = Number(daysCount);

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { title: regex },
                { description: regex },
                { mainCategory: regex },
                { subCategory: regex },
                { planId: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodHealthyPlans.countDocuments(query);

        const masterPlans = await FoodHealthyPlans.find(query)
            .populate({
                path: 'dayWiseSchedule.breakfast dayWiseSchedule.lunch dayWiseSchedule.dinner',
                select: 'name imageUrl price discountPrice calories dietType foodEffectCategory',
                strictPopulate: false
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 🧮 Fast Aggregation for Subscriber Stats per Plan
        const planStats = await FoodBooking.aggregate([
            { $match: { bookingType: 'Healthy Plan' } },
            {
                $group: {
                    _id: '$healthyPlanDetails.healthyPlanId',
                    totalSubscribersCount: { $sum: 1 },
                    activeSubscribersCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] }
                    }
                }
            }
        ]);

        const statsMap = new Map();
        planStats.forEach(s => {
            if (s._id) statsMap.set(s._id.toString(), s);
        });

        // Format clean master plan cards with subscriber counts
        const cleanList = masterPlans.map(plan => {
            const planKey = plan._id.toString();
            const stat = statsMap.get(planKey) || { totalSubscribersCount: 0, activeSubscribersCount: 0 };

            const pPerMeal = Number(plan.pricing?.pricePerMeal || 0);
            const dPricePerMeal = Number(plan.pricing?.discountPricePerMeal || 0);

            let mealsPerDay = 3;
            if (plan.programType === 'Lunches & Dinners' || plan.programType === 'Breakfast & Lunch') {
                mealsPerDay = 2;
            }
            const totalMeals = mealsPerDay * (Number(plan.daysCount) || 1);

            const finalTotalPrice = plan.pricing?.totalPrice && Number(plan.pricing.totalPrice) > 0 
                ? Number(plan.pricing.totalPrice) 
                : (pPerMeal * totalMeals);

            const finalDiscountTotalPrice = plan.pricing?.discountTotalPrice && Number(plan.pricing.discountTotalPrice) > 0 
                ? Number(plan.pricing.discountTotalPrice) 
                : ((dPricePerMeal > 0 ? dPricePerMeal : pPerMeal) * totalMeals);

            const finalSavingsAmount = Math.max(0, finalTotalPrice - finalDiscountTotalPrice);

            return {
                _id: plan._id,
                planId: plan.planId,
                title: plan.title,
                description: plan.description,
                tagline: plan.tagline,
                mainCategory: plan.mainCategory,
                subCategory: plan.subCategory,
                programType: plan.programType,
                daysCount: plan.daysCount,
                isRepeatAfter7Days: plan.isRepeatAfter7Days,
                totalSubscribersCount: stat.totalSubscribersCount,
                activeSubscribersCount: stat.activeSubscribersCount,
                pricing: {
                    pricePerMeal: pPerMeal,
                    discountPricePerMeal: dPricePerMeal,
                    totalPrice: finalTotalPrice,
                    discountTotalPrice: finalDiscountTotalPrice,
                    savingsAmount: finalSavingsAmount
                },
                bannerImage: plan.bannerImage,
                images: plan.images || [],
                isDeleted: Boolean(plan.isDeleted),
                isActive: plan.isActive,
                createdAt: plan.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1.2 GET SINGLE HEALTHY PLAN FULL DETAILS WITH SUBSCRIBED USERS LIST ---
// Full Path: GET /admin/food/plan-orders/healthy-plans/:id
const getAdminHealthyPlanOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        // 1. Fetch Master Healthy Plan Details
        const plan = await FoodHealthyPlans.findOne(query)
            .populate({
                path: 'dayWiseSchedule.breakfast dayWiseSchedule.lunch dayWiseSchedule.dinner',
                select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags glycemicIndex netCarbs sodium',
                strictPopulate: false
            })
            .lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Healthy Diet Plan not found." });
        }

        // 2. Fetch all users who purchased this specific plan
        const purchases = await FoodBooking.find({
            bookingType: 'Healthy Plan',
            $or: [
                { 'healthyPlanDetails.healthyPlanId': plan._id },
                { 'healthyPlanDetails.planId': plan.planId }
            ]
        })
        .select('bookingId status paymentStatus paymentMethod billSummary deliveryOTP  healthyPlanDetails paymentDetails createdAt userId foodId')
        .populate('userId', 'name phone email profilePic')
        .populate('foodId', 'name city profileImage phone')
        .sort({ createdAt: -1 })
        .lean();

        // 3. Format Subscribed Users List with payment details
        const subscribers = purchases.map(order => {
            const h = order.healthyPlanDetails || {};
            const startAt = h.startAtThisDate || h.startDate;
            const endAt = h.endDate;

            return {
                bookingId: order.bookingId,
                status: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                totalAmount: order.billSummary?.totalAmount || 0,
                deliveryOTP: order.deliveryOTP,
                startAtThisDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: endAt ? new Date(endAt).toISOString().split('T')[0] : null,
                userNote: h.userNote || "",
                purposeOfBuying: h.purposeOfBuying || "",
                deliveryTimes: h.deliveryTimes || {},
                user: {
                    _id: order.userId?._id,
                    name: order.userId?.name || order.address?.name || "Customer",
                    phone: order.userId?.phone || order.address?.phone || "",
                    email: order.userId?.email || "",
                    profilePic: order.userId?.profilePic || null
                },
                kitchen: {
                    _id: order.foodId?._id,
                    name: order.foodId?.name || "Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    profileImage: order.foodId?.profileImage || null
                },
                address: order.address,
                paymentDetails: order.paymentDetails || {},
                bookedAt: order.createdAt
            };
        });

        // 4. Calculate Summary Metrics
        const activeSubscribers = subscribers.filter(s => s.status === 'Active').length;
        const totalSubscribers = subscribers.length;

        res.json({
            success: true,
            data: {
                ...plan,
                subscriberMetrics: {
                    totalSubscribers,
                    activeSubscribers
                },
                subscribers // 👈 🌟 All users who purchased this plan with user info & payment details
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🍱 GROUP 2: STANDARD TIFFIN SUBSCRIPTIONS (PLANS LIST & WITH SUBSCRIBED USERS)
// =========================================================================

// --- 2.1 GET ALL STANDARD TIFFIN PLANS (WITH DYNAMIC SUBSCRIBER COUNTS) ---
// Full Path: GET /admin/food/plan-orders/subscriptions
const getAdminSubscriptionOrdersList = async (req, res) => {
    try {
        const { billingCycle, search, page = 1, limit = 20 } = req.query;

        const query = {};
        if (billingCycle) query.planCycle = new RegExp(`^${billingCycle.trim()}$`, 'i');

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { description: regex },
                { planId: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await TiffinPlan.countDocuments(query);

        const masterPlans = await TiffinPlan.find(query)
            .populate({
                path: 'slotDishes.breakfast.itemId slotDishes.lunch.itemId slotDishes.dinner.itemId dishPool',
                select: 'name imageUrl price discountPrice calories dietType',
                strictPopulate: false
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 🧮 Fast Aggregation for Subscriber Stats per Plan
        const subscriptionStats = await FoodBooking.aggregate([
            { $match: { bookingType: 'Subscription' } },
            {
                $group: {
                    _id: '$subscriptionDetails.planId',
                    totalSubscribersCount: { $sum: 1 },
                    activeSubscribersCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] }
                    }
                }
            }
        ]);

        const statsMap = new Map();
        subscriptionStats.forEach(s => {
            if (s._id) statsMap.set(s._id.toString(), s);
        });

        const cleanList = masterPlans.map(plan => {
            const statById = statsMap.get(plan._id.toString());
            const statByCode = statsMap.get(plan.planId);
            const totalSubscribersCount = (statById?.totalSubscribersCount || 0) + (statByCode?.totalSubscribersCount || 0);
            const activeSubscribersCount = (statById?.activeSubscribersCount || 0) + (statByCode?.activeSubscribersCount || 0);

            return {
                _id: plan._id,
                planId: plan.planId,
                name: plan.name,
                planCycle: plan.planCycle,
                mealsPerDay: plan.mealsPerDay,
                price: plan.price,
                permittedSlots: plan.permittedSlots,
                description: plan.description,
                totalSubscribersCount,
                activeSubscribersCount,
                isDeleted: Boolean(plan.isDeleted),
                isActive: plan.isActive,
                createdAt: plan.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.2 GET SINGLE TIFFIN PLAN FULL DETAILS WITH SUBSCRIBED USERS LIST ---
// Full Path: GET /admin/food/plan-orders/subscriptions/:id
const getAdminSubscriptionOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        const plan = await TiffinPlan.findOne(query)
            .populate({
                path: 'slotDishes.breakfast.itemId slotDishes.lunch.itemId slotDishes.dinner.itemId dishPool',
                select: 'name description imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
                strictPopulate: false
            })
            .lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription Plan not found." });
        }

        // Fetch all users who subscribed to this specific plan
        const purchases = await FoodBooking.find({
            bookingType: 'Subscription',
            $or: [
                { 'subscriptionDetails.planId': plan._id.toString() },
                { 'subscriptionDetails.planId': plan.planId }
            ]
        })
        .select('bookingId status paymentStatus paymentMethod billSummary deliveryOTP subscriptionDetails paymentDetails createdAt userId foodId')
        .populate('userId', 'name phone email profilePic')
        .populate('foodId', 'name city profileImage phone')
        .sort({ createdAt: -1 })
        .lean();

        const subscribers = purchases.map(order => {
            const s = order.subscriptionDetails || {};
            const startAt = s.startDate;
            const endAt = s.endDate;

            return {
                bookingId: order.bookingId,
                status: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                totalAmount: order.billSummary?.totalAmount || 0,
                deliveryOTP: order.deliveryOTP,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: endAt ? new Date(endAt).toISOString().split('T')[0] : null,
                billingCycle: s.billingCycle || "weekly",
                user: {
                    _id: order.userId?._id,
                    name: order.userId?.name || order.address?.name || "Customer",
                    phone: order.userId?.phone || order.address?.phone || "",
                    email: order.userId?.email || "",
                    profilePic: order.userId?.profilePic || null
                },
                kitchen: {
                    _id: order.foodId?._id,
                    name: order.foodId?.name || "Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    profileImage: order.foodId?.profileImage || null
                },
                address: order.address,
                paymentDetails: order.paymentDetails || {},
                bookedAt: order.createdAt
            };
        });

        const activeSubscribers = subscribers.filter(s => s.status === 'Active').length;
        const totalSubscribers = subscribers.length;

        res.json({
            success: true,
            data: {
                ...plan,
                subscriberMetrics: {
                    totalSubscribers,
                    activeSubscribers
                },
                subscribers // 👈 🌟 All users who subscribed to this tiffin plan
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🎨 GROUP 3: CUSTOM PLATE ORDERS (ORDERS LIST & DETAIL)
// =========================================================================

// --- 3.1 GET ALL CUSTOM PLATE ORDERS ---
// Full Path: GET /admin/food/plan-orders/custom-plates
const getAdminCustomPlateOrdersList = async (req, res) => {
    try {
        const { status, paymentStatus, foodId, dietaryType, search, page = 1, limit = 20 } = req.query;

        const query = { bookingType: 'Custom Plate' };

        if (status) query.status = status;
        if (paymentStatus) query.paymentStatus = paymentStatus;
        if (foodId) query.foodId = foodId;
        if (dietaryType) query["customTiffinDetails.dietaryType"] = dietaryType;

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { "address.name": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodBooking.countDocuments(query);

        const orders = await FoodBooking.find(query)
            .select('_id bookingId status bookingType paymentStatus paymentMethod billSummary.totalAmount foodId userId customTiffinDetails address createdAt paymentDetails')
            .populate('userId', 'name phone email profilePic')
            .populate('foodId', 'name city profileImage phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const cleanList = orders.map(order => {
            const c = order.customTiffinDetails || {};
            const startAt = c.startDate;
            const endAt = c.endDate;

            return {
                _id: order._id,
                bookingId: order.bookingId,
                bookingType: "Custom Plate",
                planTitle: `Custom ${c.packageDays || 10}-Day Plate`,
                packageDays: c.packageDays || 10,
                dietaryType: c.dietaryType || "veg",
                customer: {
                    _id: order.userId?._id,
                    name: order.userId?.name || order.address?.name || "Customer",
                    phone: order.userId?.phone || order.address?.phone || "",
                    email: order.userId?.email || "",
                    profilePic: order.userId?.profilePic || null
                },
                kitchen: {
                    _id: order.foodId?._id,
                    name: order.foodId?.name || "Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    profileImage: order.foodId?.profileImage || null
                },
                status: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                paymentDetails: order.paymentDetails || {},
                totalAmount: order.billSummary?.totalAmount || 0,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: endAt ? new Date(endAt).toISOString().split('T')[0] : null,
                createdAt: order.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3.2 GET SINGLE CUSTOM PLATE FULL DETAILS BY ID ---
// Full Path: GET /admin/food/plan-orders/custom-plates/:id
const getAdminCustomPlateOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], bookingType: 'Custom Plate' }
            : { bookingId: id, bookingType: 'Custom Plate' };

        const order = await FoodBooking.findOne(query)
            .populate('userId', 'name phone email gender dob profilePic fatherName')
            .populate('foodId', 'name profileImage address city state phone rating email')
            .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status')
            .populate({
                path: 'customTiffinDetails.weeklyCustomSchedule.breakfast.mealId customTiffinDetails.weeklyCustomSchedule.lunch.mealId customTiffinDetails.weeklyCustomSchedule.dinner.mealId',
                select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags',
                strictPopulate: false
            })
            .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Custom Plate order details not found." });
        }

        delete order.healthyPlanDetails;
        delete order.subscriptionDetails;
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

// ==========================================
// 👥 GET HEALTHY PLAN SUBSCRIBED USERS LIST (ICON CLICK API - NO ADDRESS)
// Full Path: GET /admin/food/plan-orders/healthy-plans/:planId/subscribers
// ==========================================
const getHealthyPlanSubscribedUsers = async (req, res) => {
    try {
        const { planId } = req.params;

        // 1. Resolve Plan (by _id or custom planId like HLP-106)
        const planQuery = mongoose.Types.ObjectId.isValid(planId)
            ? { $or: [{ _id: planId }, { planId }] }
            : { planId };

        const plan = await FoodHealthyPlans.findOne(planQuery).select('_id planId title mainCategory subCategory daysCount').lean();

        if (!plan) {
            return res.status(404).json({ success: false, message: "Healthy diet plan not found." });
        }

        // 2. Fetch all booking orders for this plan
        const purchases = await FoodBooking.find({
            bookingType: 'Healthy Plan',
            $or: [
                { 'healthyPlanDetails.healthyPlanId': plan._id },
                { 'healthyPlanDetails.planId': plan.planId }
            ]
        })
        .select('bookingId status paymentStatus paymentMethod billSummary healthyPlanDetails paymentDetails createdAt userId foodId')
        .populate('userId', 'name phone email profilePic')
        .populate('foodId', 'name city profileImage phone')
        .sort({ createdAt: -1 })
        .lean();

        // 3. Format Subscribed Users List (Excluding Address)
        const subscribers = purchases.map(order => {
            const h = order.healthyPlanDetails || {};
            const startAt = h.startAtThisDate || h.startDate;
            const endAt = h.endDate;

            return {
                bookingId: order.bookingId,
                status: order.status,
                startAtThisDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: endAt ? new Date(endAt).toISOString().split('T')[0] : null,
                userNote: h.userNote || "",
                purposeOfBuying: h.purposeOfBuying || "",
                deliveryTimes: h.deliveryTimes || {},
                bookedAt: order.createdAt,
                // 👤 User Details (Address Excluded):
                user: {
                    _id: order.userId?._id,
                    name: order.userId?.name || "Customer",
                    phone: order.userId?.phone || "",
                    email: order.userId?.email || "",
                    profilePic: order.userId?.profilePic || null
                },
                // 🏪 Vendor / Kitchen Details:
                vendorDetails: {
                    _id: order.foodId?._id,
                    name: order.foodId?.name || "Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    phone: order.foodId?.phone || "",
                    profileImage: order.foodId?.profileImage || null
                },
                // 💳 Payment Details:
                paymentDetails: {
                    paymentMethod: order.paymentMethod,
                    paymentStatus: order.paymentStatus,
                    totalAmount: order.billSummary?.totalAmount || 0,
                    razorpayPaymentId: order.paymentDetails?.razorpayPaymentId || "",
                    razorpayOrderId: order.paymentDetails?.razorpayOrderId || "",
                    paidAt: order.paymentDetails?.paidAt || null
                }
            };
        });

        res.json({
            success: true,
            planInfo: {
                _id: plan._id,
                planId: plan.planId,
                title: plan.title,
                mainCategory: plan.mainCategory,
                subCategory: plan.subCategory,
                daysCount: plan.daysCount
            },
            totalUsers: subscribers.length,
            activeUsers: subscribers.filter(s => s.status === 'Active').length,
            subscribers // 👈 All users list with user, vendor & payment details
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    // ... existing exports
    getHealthyPlanSubscribedUsers
};
module.exports = {
    // 🥗 Healthy Plans
    getAdminHealthyPlanOrdersList,
    getAdminHealthyPlanOrderById,

    // 🍱 Standard Subscriptions
    getAdminSubscriptionOrdersList,
    getAdminSubscriptionOrderById,

    // 🎨 Custom Plates
    getAdminCustomPlateOrdersList,
    getAdminCustomPlateOrderById,

    getHealthyPlanSubscribedUsers
};