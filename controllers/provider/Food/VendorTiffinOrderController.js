// controllers/provider/Food/VendorTiffinOrderController.js

const FoodBooking = require('../../../models/FoodBooking');
const { sendPushNotification } = require('../../../utils/notification');
const mongoose = require('mongoose'); // 👈 Fixed: Added missing mongoose import

// ==========================================
// 💡 HELPER: CALCULATE REMAINING DAYS PRO-RATA REFUND
// ==========================================
const calculatePlanCancellationRefund = (order) => {
    const totalPaid = order.billSummary?.totalAmount || 0;
    const isPaid = order.paymentStatus === 'Paid';

    if (!isPaid || totalPaid <= 0) {
        return {
            isRefundApplicable: false,
            refundAmount: 0,
            totalPaidAmount: 0,
            totalPlanDays: 0,
            consumedDays: 0,
            remainingDays: 0,
            refundStatus: 'Not Applicable'
        };
    }

    let totalDays = 1;
    let startDate = order.createdAt;

    if (order.bookingType === 'Healthy Plan') {
        totalDays = Number(order.healthyPlanDetails?.daysCount) || 5;
        startDate = order.healthyPlanDetails?.startAtThisDate || order.healthyPlanDetails?.startDate || order.createdAt;
    } else if (order.bookingType === 'Subscription') {
        totalDays = Number(order.subscriptionDetails?.durationDays) || (order.subscriptionDetails?.billingCycle === 'monthly' ? 30 : 7);
        startDate = order.subscriptionDetails?.startDate || order.createdAt;
    } else if (order.bookingType === 'Custom Plate') {
        totalDays = Number(order.customTiffinDetails?.packageDays) || 10;
        startDate = order.customTiffinDetails?.startDate || order.createdAt;
    }

    const start = new Date(startDate);
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    let consumedDays = 0;
    let remainingDays = totalDays;

    if (today < start) {
        // Plan shuru nahi hua tha -> 100% Full Refund
        consumedDays = 0;
        remainingDays = totalDays;
    } else {
        // Plan ongoing tha -> Consumed days calculation
        const diffMs = today.getTime() - start.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
        consumedDays = Math.min(totalDays, Math.max(1, daysPassed));
        remainingDays = Math.max(0, totalDays - consumedDays);
    }

    if (order.bookingType === 'Direct') {
        consumedDays = 0;
        remainingDays = 1;
        totalDays = 1;
    }

    const perDayCost = totalPaid / totalDays;
    const refundAmount = Math.round(perDayCost * remainingDays);

    return {
        isRefundApplicable: refundAmount > 0,
        refundAmount,
        totalPaidAmount: totalPaid,
        totalPlanDays: totalDays,
        consumedDays,
        remainingDays,
        refundStatus: refundAmount > 0 ? 'Pending' : 'Not Applicable'
    };
};

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

        const subscriptions = await FoodBooking.find(query)
            .select('_id bookingId status bookingType subscriptionDetails.planName subscriptionDetails.billingCycle subscriptionDetails.startDate subscriptionDetails.endDate billSummary.totalAmount address.name address.phone createdAt')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const cleanList = subscriptions.map(sub => {
            const start = sub.subscriptionDetails?.startDate;
            const end = sub.subscriptionDetails?.endDate;

            return {
                _id: sub._id,
                bookingId: sub.bookingId,
                bookingType: "Subscription",
                planType: "Subscription",
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

// ==========================================
// 🔍 2. GET SINGLE STANDARD SUBSCRIPTION FULL DETAILS BY ID
// Full Path: GET /provider/food/tiffin/subscriptions/:id
// ==========================================
const getVendorTiffinSubscriptionById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], foodId: vendorId, bookingType: 'Subscription' }
            : { bookingId: id, foodId: vendorId, bookingType: 'Subscription' };

        const subscription = await FoodBooking.findOne(query)
            .populate('userId', 'name phone email gender dob profilePic')
            .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status location')
            .populate({
                path: 'subscriptionDetails.dailyMealSchedule.mealId',
                select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags',
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

        // Clean unneeded blocks
        delete subscription.customTiffinDetails;
        delete subscription.healthyPlanDetails;
        delete subscription.items;
        delete subscription.addons;

        res.json({
            success: true,
            data: {
                ...subscription,
                bookingType: "Subscription",
                planType: "Subscription"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 3. CANCEL STANDARD SUBSCRIPTION (WITH PRO-RATA AUTO-REFUND)
// Full Path: PATCH /provider/food/tiffin/subscriptions/:id/action
// ==========================================
const handleStandardTiffinSubscriptionAction = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;
        const cancelReason = req.body.cancelReason || req.body.rejectReason || req.body.reason;

        if (!cancelReason || cancelReason.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "A valid cancellation reason (cancelReason) is mandatory." 
            });
        }

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], foodId: vendorId, bookingType: 'Subscription' }
            : { bookingId: id, foodId: vendorId, bookingType: 'Subscription' };

        const subscription = await FoodBooking.findOne(query);

        if (!subscription) {
            return res.status(404).json({ 
                success: false, 
                message: "Tiffin subscription not found or not assigned to your kitchen." 
            });
        }

        if (subscription.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This subscription is already cancelled." });
        }

        if (subscription.status === 'Delivered' || subscription.status === 'Expired') {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot cancel a completed or expired subscription (Current status: '${subscription.status}').` 
            });
        }

        // 1. Set Status & Reason
        subscription.status = 'Cancelled';
        subscription.cancelReason = cancelReason.trim();

        // 2. 🧮 Auto-Calculate Pro-Rata Refund
        const refundCalc = calculatePlanCancellationRefund(subscription);
        subscription.refundDetails = refundCalc;

        if (refundCalc.isRefundApplicable) {
            subscription.paymentStatus = 'Refund-Initiated';
        }

        // 3. Save in DB
        await subscription.save();

        // 4. 🔔 Send Push Notification
        if (subscription.userId) {
            const planDisplayName = subscription.subscriptionDetails?.planName || 'Tiffin Subscription';
            sendPushNotification(
                subscription.userId,
                'user',
                `${planDisplayName} Cancelled`,
                `Your ${planDisplayName} was cancelled by the kitchen. Reason: ${subscription.cancelReason}`,
                { bookingId: subscription.bookingId, type: 'TIFFIN_SUBSCRIPTION_REJECTED', bookingType: 'Subscription' }
            ).catch(() => {});
        }

        return res.json({
            success: true,
            message: `Tiffin subscription (${subscription.bookingId}) cancelled successfully. Reason logged and refund calculated.`,
            data: {
                bookingId: subscription.bookingId,
                bookingType: "Subscription",
                planType: "Subscription",
                status: subscription.status,
                paymentStatus: subscription.paymentStatus,
                cancelReason: subscription.cancelReason,
                refundInfo: subscription.refundDetails,
                updatedAt: subscription.updatedAt
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🎨 4. GET ALL CUSTOM TIFFIN REQUESTS (Lightweight Card List)
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

        const customRequests = await FoodBooking.find(query)
            .select('_id bookingId status bookingType customTiffinDetails.packageDays customTiffinDetails.startDate customTiffinDetails.endDate customTiffinDetails.dietaryType billSummary.totalAmount address.name address.phone createdAt')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const cleanList = customRequests.map(plan => {
            const start = plan.customTiffinDetails?.startDate;
            const end = plan.customTiffinDetails?.endDate;

            return {
                _id: plan._id,
                bookingId: plan.bookingId,
                bookingType: "Custom Plate",
                planType: "Custom Plate",
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

// ==========================================
// 🔍 5. GET SINGLE CUSTOM TIFFIN REQUEST FULL DETAILS
// Full Path: GET /provider/food/tiffin/custom-requests/:id
// ==========================================
const getVendorCustomTiffinRequestById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], foodId: vendorId, bookingType: 'Custom Plate' }
            : { bookingId: id, foodId: vendorId, bookingType: 'Custom Plate' };

        const customOrder = await FoodBooking.findOne(query)
            .populate('userId', 'name phone email gender dob profilePic')
            .populate('driverId', 'name phone vehicleType vehicleNumber status')
            .populate({
                path: 'customTiffinDetails.weeklyCustomSchedule.breakfast.mealId customTiffinDetails.weeklyCustomSchedule.lunch.mealId customTiffinDetails.weeklyCustomSchedule.dinner.mealId',
                select: 'name description imageUrl price discountPrice calories dietType foodEffectCategory ingredients tags',
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

        // Clean unneeded blocks
        delete customOrder.subscriptionDetails;
        delete customOrder.healthyPlanDetails;
        delete customOrder.items;
        delete customOrder.addons;

        res.json({
            success: true,
            data: {
                ...customOrder,
                bookingType: "Custom Plate",
                planType: "Custom Plate"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 6. HANDLE CUSTOM TIFFIN ACTION (ACCEPT / CANCEL WITH REFUND)
// Full Path: PATCH /provider/food/tiffin/custom-requests/:id/action
// ==========================================
const handleCustomTiffinRequestAction = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;
        const { action } = req.body;
        const reason = req.body.cancelReason || req.body.rejectReason || req.body.reason;

        if (!action || !['Accept', 'Reject', 'Cancel'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                message: "Action must be 'Accept', 'Reject' (for New requests), or 'Cancel' (for Active requests)." 
            });
        }

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], foodId: vendorId, bookingType: 'Custom Plate' }
            : { bookingId: id, foodId: vendorId, bookingType: 'Custom Plate' };

        const customOrder = await FoodBooking.findOne(query);

        if (!customOrder) {
            return res.status(404).json({ success: false, message: "Custom tiffin request not found." });
        }

        if (customOrder.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This custom tiffin package is already cancelled." });
        }

        if (customOrder.status === 'Delivered' || customOrder.status === 'Expired') {
            return res.status(400).json({ success: false, message: "Cannot modify a completed or expired custom package." });
        }

        // --- PHASE 1: INITIAL REQUEST ('New' / 'Pending') ---
        if (customOrder.status === 'New' || customOrder.status === 'Pending') {
            if (action === 'Cancel') {
                return res.status(400).json({
                    success: false,
                    message: "Order is not yet accepted. Use action 'Reject' with rejectReason to decline new requests."
                });
            }

            if (action === 'Accept') {
                customOrder.status = 'Active';
                await customOrder.save();

                if (customOrder.userId) {
                    sendPushNotification(
                        customOrder.userId,
                        'user',
                        'Custom Tiffin Package Accepted! 🎉',
                        `Your kitchen has accepted your Custom ${customOrder.customTiffinDetails?.packageDays || 10}-Day Tiffin package.`,
                        { bookingId: customOrder.bookingId, type: 'CUSTOM_TIFFIN_ACCEPTED' }
                    ).catch(() => {});
                }

                return res.json({
                    success: true,
                    message: `Custom Tiffin package (${customOrder.bookingId}) accepted successfully!`,
                    data: {
                        bookingId: customOrder.bookingId,
                        bookingType: "Custom Plate",
                        status: customOrder.status,
                        updatedAt: customOrder.updatedAt
                    }
                });
            }

            if (action === 'Reject') {
                if (!reason || reason.trim().length === 0) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "A valid rejectReason is mandatory when rejecting a new request." 
                    });
                }

                customOrder.status = 'Cancelled';
                customOrder.cancelReason = reason.trim();

                // 🧮 Auto-Calculate 100% Full Refund if rejected before starting
                const refundCalc = calculatePlanCancellationRefund(customOrder);
                customOrder.refundDetails = refundCalc;
                if (refundCalc.isRefundApplicable) {
                    customOrder.paymentStatus = 'Refund-Initiated';
                }

                await customOrder.save();

                if (customOrder.userId) {
                    sendPushNotification(
                        customOrder.userId,
                        'user',
                        'Custom Tiffin Package Rejected',
                        `Your custom tiffin request was rejected. Reason: ${customOrder.cancelReason}`,
                        { bookingId: customOrder.bookingId, type: 'CUSTOM_TIFFIN_REJECTED' }
                    ).catch(() => {});
                }

                return res.json({
                    success: true,
                    message: `Custom Tiffin package (${customOrder.bookingId}) rejected. Reason logged and refund initiated.`,
                    data: {
                        bookingId: customOrder.bookingId,
                        bookingType: "Custom Plate",
                        status: customOrder.status,
                        paymentStatus: customOrder.paymentStatus,
                        cancelReason: customOrder.cancelReason,
                        refundInfo: customOrder.refundDetails,
                        updatedAt: customOrder.updatedAt
                    }
                });
            }
        }

        // --- PHASE 2: ALREADY ACTIVE ('Active') ---
        if (customOrder.status === 'Active') {
            if (action === 'Accept' || action === 'Reject') {
                return res.status(400).json({ 
                    success: false, 
                    message: "This package is already Active. Use action 'Cancel' with cancelReason to cancel an ongoing subscription." 
                });
            }

            if (action === 'Cancel') {
                if (!reason || reason.trim().length === 0) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "A valid cancelReason is mandatory when cancelling an active subscription." 
                    });
                }

                customOrder.status = 'Cancelled';
                customOrder.cancelReason = reason.trim();

                // 🧮 Auto-Calculate Pro-Rata Refund for Remaining Days
                const refundCalc = calculatePlanCancellationRefund(customOrder);
                customOrder.refundDetails = refundCalc;
                if (refundCalc.isRefundApplicable) {
                    customOrder.paymentStatus = 'Refund-Initiated';
                }

                await customOrder.save();

                if (customOrder.userId) {
                    sendPushNotification(
                        customOrder.userId,
                        'user',
                        'Custom Tiffin Package Cancelled',
                        `Your active custom tiffin package was cancelled by the kitchen. Reason: ${customOrder.cancelReason}`,
                        { bookingId: customOrder.bookingId, type: 'CUSTOM_TIFFIN_CANCELLED' }
                    ).catch(() => {});
                }

                return res.json({
                    success: true,
                    message: `Active Custom Tiffin package (${customOrder.bookingId}) cancelled successfully. Reason logged and refund initiated.`,
                    data: {
                        bookingId: customOrder.bookingId,
                        bookingType: "Custom Plate",
                        status: customOrder.status,
                        paymentStatus: customOrder.paymentStatus,
                        cancelReason: customOrder.cancelReason,
                        refundInfo: customOrder.refundDetails,
                        updatedAt: customOrder.updatedAt
                    }
                });
            }
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getVendorTiffinSubscriptions,
    getVendorTiffinSubscriptionById,
    handleStandardTiffinSubscriptionAction,
    getVendorCustomTiffinRequests,
    getVendorCustomTiffinRequestById,
    handleCustomTiffinRequestAction
};