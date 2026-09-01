// controllers/provider/Food/VendorTiffinOrderController.js

const FoodBooking = require('../../../models/FoodBooking');

// ==========================================
// 🍱 1. GET ALL VENDOR STANDARD SUBSCRIPTIONS (Lightweight Card List)
// Full Path: GET /provider/food/tiffin/subscriptions
// ==========================================
const getVendorTiffinSubscriptions = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { status, billingCycle, search, page = 1, limit = 20 } = req.query;

        const query = {
            foodId: vendorId,
            bookingType: 'Subscription'
        };

        if (status) query.status = status;
        if (billingCycle) query["subscriptionDetails.billingCycle"] = billingCycle;

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { "address.name": regex },
                { "address.phone": regex },
                { "subscriptionDetails.planName": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodBooking.countDocuments(query);

        // Essential fields for clean lightweight card rendering
        const subscriptions = await FoodBooking.find(query)
            .select('_id bookingId status bookingType subscriptionDetails.planName subscriptionDetails.billingCycle subscriptionDetails.startDate subscriptionDetails.endDate billSummary.totalAmount address.name address.phone createdAt')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 🛡️ Format clean card payload with explicit discriminator keys
        const cleanList = subscriptions.map(sub => {
            const start = sub.subscriptionDetails?.startDate;
            const end = sub.subscriptionDetails?.endDate;

            return {
                _id: sub._id,
                bookingId: sub.bookingId,
                bookingType: "Subscription",                                              // 👈 🌟 Discriminator Key
                planType: "Subscription",                                                 // 👈 🌟 Helper Key
                customerName: sub.userId?.name || sub.address?.name || "Customer",
                customerPhone: sub.userId?.phone || sub.address?.phone || "",
                planName: sub.subscriptionDetails?.planName || "Tiffin Subscription Plan",
                billingCycle: sub.subscriptionDetails?.billingCycle || "weekly",
                status: sub.status,
                totalAmount: sub.billSummary?.totalAmount || 0,
                startDate: start ? new Date(start).toISOString().split('T')[0] : null,
                endDate: end ? new Date(end).toISOString().split('T')[0] : null,
                createdAt: sub.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)),
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 2. GET SINGLE STANDARD SUBSCRIPTION FULL DETAILS BY ID
// Full Path: GET /provider/food/tiffin/subscriptions/:id
// ==========================================
const getVendorTiffinSubscriptionById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        const subscription = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId,
            bookingType: 'Subscription'
        })
        .populate('userId', 'name phone email gender dob profilePic')
        .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status location')
        .populate({
            path: 'subscriptionDetails.dailyMealSchedule.mealId',
            select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
            strictPopulate: false
        })
        .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!subscription) {
            return res.status(404).json({ 
                success: false, 
                message: "Tiffin subscription not found or not assigned to your kitchen." 
            });
        }

        res.json({
            success: true,
            data: {
                ...subscription,
                bookingType: "Subscription", // 👈 🌟 Explicit Key in Detail View
                planType: "Subscription"     // 👈 🌟 Explicit Key in Detail View
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🎨 3. GET ALL CUSTOM TIFFIN REQUESTS (Lightweight Card List)
// Full Path: GET /provider/food/tiffin/custom-requests
// ==========================================
const getVendorCustomTiffinRequests = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { status, search, page = 1, limit = 20 } = req.query;

        const query = {
            foodId: vendorId,
            bookingType: 'Custom Plate'
        };

        if (status) query.status = status;

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

        // Essential fields for clean lightweight card rendering
        const customRequests = await FoodBooking.find(query)
            .select('_id bookingId status bookingType customTiffinDetails.packageDays customTiffinDetails.startDate customTiffinDetails.endDate customTiffinDetails.dietaryType billSummary.totalAmount address.name address.phone createdAt')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 🛡️ Format clean card payload with explicit discriminator keys
        const cleanList = customRequests.map(plan => {
            const start = plan.customTiffinDetails?.startDate;
            const end = plan.customTiffinDetails?.endDate;

            return {
                _id: plan._id,
                bookingId: plan.bookingId,
                bookingType: "Custom Plate",                                            // 👈 🌟 Discriminator Key
                planType: "Custom Plate",                                               // 👈 🌟 Helper Key
                customerName: plan.userId?.name || plan.address?.name || "Customer",
                customerPhone: plan.userId?.phone || plan.address?.phone || "",
                packageDays: plan.customTiffinDetails?.packageDays || 10,
                dietaryType: plan.customTiffinDetails?.dietaryType || 'veg',
                status: plan.status,
                totalAmount: plan.billSummary?.totalAmount || 0,
                startDate: start ? new Date(start).toISOString().split('T')[0] : null,
                endDate: end ? new Date(end).toISOString().split('T')[0] : null,
                createdAt: plan.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)),
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 4. GET SINGLE CUSTOM TIFFIN REQUEST FULL DETAILS
// Full Path: GET /provider/food/tiffin/custom-requests/:id
// ==========================================
const getVendorCustomTiffinRequestById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        const customOrder = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId,
            bookingType: 'Custom Plate'
        })
        .populate('userId', 'name phone email gender dob profilePic')
        .populate('driverId', 'name phone vehicleType vehicleNumber status')
        .populate({
            path: 'customTiffinDetails.weeklyCustomSchedule.breakfast.mealId',
            select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
            strictPopulate: false
        })
        .populate({
            path: 'customTiffinDetails.weeklyCustomSchedule.lunch.mealId',
            select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
            strictPopulate: false
        })
        .populate({
            path: 'customTiffinDetails.weeklyCustomSchedule.dinner.mealId',
            select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
            strictPopulate: false
        })
        .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!customOrder) {
            return res.status(404).json({ 
                success: false, 
                message: "Custom tiffin request not found or not assigned to your kitchen." 
            });
        }

        res.json({
            success: true,
            data: {
                ...customOrder,
                bookingType: "Custom Plate", // 👈 🌟 Explicit Key in Detail View
                planType: "Custom Plate"     // 👈 🌟 Explicit Key in Detail View
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 5. ACCEPT OR REJECT CUSTOM TIFFIN REQUEST (WITH REASON)
// Full Path: PATCH /provider/food/tiffin/custom-requests/:id/action
// ==========================================
const handleCustomTiffinRequestAction = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;
        const { action, rejectReason } = req.body; // action: 'Accept' ya 'Reject'

        if (!action || !['Accept', 'Reject'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                message: "Action must be either 'Accept' or 'Reject'." 
            });
        }

        const customOrder = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId,
            bookingType: 'Custom Plate'
        });

        if (!customOrder) {
            return res.status(404).json({ 
                success: false, 
                message: "Custom tiffin request not found." 
            });
        }

        if (customOrder.status !== 'New' && customOrder.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot modify request. This order is already '${customOrder.status}'.`
            });
        }

        // --- ACTION 1: ACCEPT CUSTOM REQUEST ---
        if (action === 'Accept') {
            customOrder.status = 'Active';
            await customOrder.save();

            return res.json({
                success: true,
                message: `Custom Tiffin package (${customOrder.bookingId}) accepted successfully!`,
                data: {
                    bookingId: customOrder.bookingId,
                    bookingType: "Custom Plate",
                    planType: "Custom Plate",
                    status: customOrder.status,
                    updatedAt: customOrder.updatedAt
                }
            });
        }

        // --- ACTION 2: REJECT CUSTOM REQUEST WITH REASON ---
        if (action === 'Reject') {
            if (!rejectReason || rejectReason.trim().length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: "A valid rejectReason is mandatory when rejecting a custom tiffin request." 
                });
            }

            customOrder.status = 'Cancelled';
            customOrder.cancelReason = rejectReason.trim();
            await customOrder.save();

            return res.json({
                success: true,
                message: `Custom Tiffin package (${customOrder.bookingId}) rejected. Reason logged.`,
                data: {
                    bookingId: customOrder.bookingId,
                    bookingType: "Custom Plate",
                    planType: "Custom Plate",
                    status: customOrder.status,
                    cancelReason: customOrder.cancelReason,
                    updatedAt: customOrder.updatedAt
                }
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getVendorTiffinSubscriptions,
    getVendorTiffinSubscriptionById,
    getVendorCustomTiffinRequests,
    getVendorCustomTiffinRequestById,
    handleCustomTiffinRequestAction
};