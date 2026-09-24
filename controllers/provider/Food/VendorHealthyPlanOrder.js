// controllers/provider/Food/VendorHealthyPlanOrderController.js

const FoodBooking = require('../../../models/FoodBooking');
const { sendPushNotification } = require('../../../utils/notification');



// ==========================================
// 💡 HELPER: CALCULATE REMAINING DAYS PRO-RATA REFUND
// ==========================================
const calculatePlanCancellationRefund = (order) => {
    const totalPaid = order.billSummary?.totalAmount || 0;
    const isPaid = order.paymentStatus === 'Paid';

    // Agar payment hi nahi hua (Unpaid COD) toh refund zero
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
        // Case A: Plan abhi start hi nahi hua tha -> 100% Full Refund
        consumedDays = 0;
        remainingDays = totalDays;
    } else {
        // Case B: Plan chal raha tha -> Calculate consumed days
        const diffMs = today.getTime() - start.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
        consumedDays = Math.min(totalDays, Math.max(1, daysPassed));
        remainingDays = Math.max(0, totalDays - consumedDays);
    }

    // Direct single orders always get full refund if cancelled
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
// 📦 1. GET ALL VENDOR HEALTHY PLAN ORDERS (Auto-Activated List)
// Full Path: GET /provider/food/healthy-plans/orders
// ==========================================
const getVendorHealthyPlanOrders = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { status, mainCategory, subCategory, search, page = 1, limit = 20 } = req.query;

        const query = {
            foodId: vendorId,
            bookingType: 'Healthy Plan'
        };

        if (status) query.status = status;
        if (mainCategory) query["healthyPlanDetails.mainCategory"] = new RegExp(`^${mainCategory.trim()}$`, 'i');
        if (subCategory) query["healthyPlanDetails.subCategory"] = new RegExp(`^${subCategory.trim()}$`, 'i');

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { "address.name": regex },
                { "address.phone": regex },
                { "healthyPlanDetails.title": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodBooking.countDocuments(query);

        // Fetch Orders with lightweight card fields
        const orders = await FoodBooking.find(query)
            .select('_id bookingId status bookingType healthyPlanDetails billSummary.totalAmount address.name address.phone paymentStatus createdAt')
            .populate('userId', 'name phone profilePic')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const cleanList = orders.map(o => {
            const h = o.healthyPlanDetails || {};
            const startAt = h.startAtThisDate || h.startDate;
            const end = h.endDate;

            return {
                _id: o._id,
                bookingId: o.bookingId,
                bookingType: "Healthy Plan",
                planTitle: h.title || "Healthy Diet Plan",
                planId: h.planId || "HLP-101",
                mainCategory: h.mainCategory,
                subCategory: h.subCategory,
                programType: h.programType,
                daysCount: h.daysCount,
                customerName: o.userId?.name || o.address?.name || "Customer",
                customerPhone: o.userId?.phone || o.address?.phone || "",
                status: o.status, // Always 'Active' on purchase
                paymentStatus: o.paymentStatus,
                totalAmount: o.billSummary?.totalAmount || 0,
                startAtThisDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                startDate: startAt ? new Date(startAt).toISOString().split('T')[0] : null,
                endDate: end ? new Date(end).toISOString().split('T')[0] : null,
                createdAt: o.createdAt
            };
        });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)),
            currentPage: parseInt(page, 10),
            count: cleanList.length,
            data: cleanList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 2. GET SINGLE HEALTHY PLAN ORDER FULL DETAILS BY ID
// Full Path: GET /provider/food/healthy-plans/orders/:id
// ==========================================
const getVendorHealthyPlanOrderById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        const order = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId,
            bookingType: 'Healthy Plan'
        })
        .populate('userId', 'name phone email gender dob profilePic')
        .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status location')
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
                message: "Healthy Plan order not found or not assigned to your kitchen."
            });
        }

        // Faltu empty blocks clean karein
        delete order.subscriptionDetails;
        delete order.customTiffinDetails;
        delete order.items;
        delete order.addons;

        res.json({
            success: true,
            data: {
                ...order,
                bookingType: "Healthy Plan"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 3. EMERGENCY CANCEL BY VENDOR (WITH AUTO-REFUND CALCULATION)
// Full Path: PATCH /provider/food/healthy-plans/orders/:id/cancel
// ==========================================
const cancelVendorHealthyPlanOrder = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;
        const cancelReason = req.body.cancelReason || req.body.reason;

        if (!cancelReason || cancelReason.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "A valid cancelReason is mandatory when cancelling a plan."
            });
        }

        const order = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId,
            bookingType: 'Healthy Plan'
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Healthy Plan order not found or not assigned to your kitchen."
            });
        }

        if (order.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This plan is already cancelled." });
        }

        if (order.status === 'Delivered' || order.status === 'Expired') {
            return res.status(400).json({ success: false, message: "Cannot cancel a completed or expired plan." });
        }

        // 1. Set Cancelled Status & Reason
        order.status = 'Cancelled';
        order.cancelReason = cancelReason.trim();

        // 2. 🧮 Auto-Calculate Pro-Rata Refund for Remaining Days
        const refundCalc = calculatePlanCancellationRefund(order);
        order.refundDetails = refundCalc;

        if (refundCalc.isRefundApplicable) {
            order.paymentStatus = 'Refund-Initiated';
        }

        // 3. Single Clean Database Save
        await order.save();

        // 4. 🔔 Send Push Notification to User
        if (order.userId) {
            sendPushNotification(
                order.userId,
                'user',
                'Healthy Diet Plan Cancelled',
                `Your healthy plan was cancelled by the kitchen. Reason: ${order.cancelReason}`,
                { bookingId: order.bookingId, type: 'HEALTHY_PLAN_CANCELLED' }
            ).catch(() => {});
        }

        return res.json({
            success: true,
            message: `Healthy Diet Plan (${order.bookingId}) cancelled successfully. Reason logged and refund initiated.`,
            data: {
                bookingId: order.bookingId,
                bookingType: "Healthy Plan",
                status: order.status,
                paymentStatus: order.paymentStatus,
                cancelReason: order.cancelReason,
                refundInfo: order.refundDetails,
                updatedAt: order.updatedAt
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getVendorHealthyPlanOrders,
    getVendorHealthyPlanOrderById,
    cancelVendorHealthyPlanOrder
};