// controllers/admin/Food/AdminFoodVendorOrdersController.js

const Food = require('../../../models/Food');
const FoodBooking = require('../../../models/FoodBooking');
const { refundRazorpayPayment } = require('../../../utils/razorpay');

const mongoose = require('mongoose');

// ==========================================
// 🏪 1. GET APPROVED FOOD OUTLETS LIST (SCREEN 1)
// Full Path: GET /admin/food/vendor-orders/outlets
// ==========================================
const getApprovedFoodOutletsList = async (req, res) => {
    try {
        const { search, city, page = 1, limit = 10 } = req.query;

        // Query only Approved Food Outlets
        const query = { profileStatus: 'Approved' };

        if (city) {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { email: regex },
                { phone: regex },
                { city: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await Food.countDocuments(query);

        // 1. Fetch Outlets
        const outlets = await Food.find(query)
            .select('_id name email phone city state address profileImage profileStatus isActive isOnline rating totalReviews createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 2. 🧮 Fast Aggregation: Count Total Orders for each Outlet
        const orderCounts = await FoodBooking.aggregate([
            { $match: { foodId: { $in: outlets.map(o => o._id) } } },
            {
                $group: {
                    _id: '$foodId',
                    totalOrdersCount: { $sum: 1 },
                    activeOrdersCount: {
                        $sum: { $cond: [{ $in: ['$status', ['New', 'Preparing', 'Ready', 'Picked Up', 'Active']] }, 1, 0] }
                    }
                }
            }
        ]);

        const orderCountMap = new Map();
        orderCounts.forEach(c => orderCountMap.set(c._id.toString(), c));

        // 3. Format Response strictly matching Screen 1 Table
        const formattedOutlets = outlets.map(outlet => {
            const countInfo = orderCountMap.get(outlet._id.toString()) || { totalOrdersCount: 0, activeOrdersCount: 0 };

            return {
                _id: outlet._id,
                outletName: outlet.name,
                email: outlet.email || "N/A",
                phone: outlet.phone || "N/A",
                city: outlet.city || "Mohali",
                state: outlet.state || "",
                address: outlet.address || "",
                profileImage: outlet.profileImage || null,
                verification: outlet.profileStatus.toUpperCase(), // "APPROVED"
                isActive: outlet.isActive,
                isOnline: outlet.isOnline,
                rating: outlet.rating || 0,
                totalOrders: countInfo.totalOrdersCount,
                activeOrders: countInfo.activeOrdersCount
            };
        });

        res.json({
            success: true,
            totalActiveOutlets: totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: formattedOutlets.length,
            data: formattedOutlets
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 2. GET VENDOR ORDER HISTORY MODAL (DIRECT ORDERS ONLY)
// Full Path: GET /admin/food/vendor-orders/:vendorId/orders
// ==========================================
const getVendorOrderHistoryModal = async (req, res) => {
    try {
        const { vendorId } = req.params;
        const { status, search, page = 1, limit = 50 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(vendorId)) {
            return res.status(400).json({ success: false, message: "Invalid Vendor ID." });
        }

        // 1. Fetch Outlet Info
        const vendor = await Food.findById(vendorId)
            .select('_id name email phone city state address profileImage rating')
            .lean();

        if (!vendor) {
            return res.status(404).json({ success: false, message: "Food Outlet not found." });
        }

        // 2. 🚨 Strictly Query ONLY 'Direct' Orders for this Outlet
        const orderQuery = { 
            foodId: vendor._id,
            bookingType: 'Direct' // 👈 Excludes Subscriptions, Healthy Plans & Custom Plates
        };

        if (status) orderQuery.status = status;

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            orderQuery.$or = [
                { bookingId: regex },
                { "address.name": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalOrders = await FoodBooking.countDocuments(orderQuery);

        const orders = await FoodBooking.find(orderQuery)
            .populate('userId', 'name phone email profilePic')
            .populate('items.itemId', 'name description price')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        // 3. Format Clean Orders List for Modal UI
        const associatedOrders = orders.map(order => {
            // Simplified Food Items (Only Name, Description, Quantity & Price)
            const foodItems = (order.items || []).map(i => ({
                name: i.name || i.itemId?.name || "Dish Item",
                description: i.itemId?.description || "",
                quantity: i.quantity || 1,
                price: i.price || i.itemId?.price || 0
            }));

            const mealSummary = foodItems.map(f => `${f.name} (x${f.quantity})`).join(', ') || "Direct Food Order";

            return {
                _id: order._id,
                orderId: order.bookingId, // E.g. "ORD-8821"
                bookingType: "Direct",

                // 👤 Customer / Patient Details
                customer: {
                    _id: order.userId?._id || null,
                    name: order.userId?.name || order.address?.name || "Customer",
                    phone: order.userId?.phone || order.address?.phone || "N/A",
                    email: order.userId?.email || "N/A",
                    profilePic: order.userId?.profilePic || null
                },

                // 📅 Order Timing
                orderDate: order.createdAt 
                    ? new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) 
                    : "N/A",
                createdAt: order.createdAt,

                // 🍔 Food Summary & Items List
                mealItemsSummary: mealSummary,
                foodItems: foodItems,

                // 💳 Amount & Payment Details
                amount: order.billSummary?.totalAmount || 0,
                payment: {
                    paymentMethod: order.paymentMethod || "COD",
                    paymentStatus: order.paymentStatus || "Pending",
                    totalAmount: order.billSummary?.totalAmount || 0,
                    razorpayPaymentId: order.paymentDetails?.razorpayPaymentId || "",
                    paidAt: order.paymentDetails?.paidAt || null
                },

                // 🚚 Status
                status: order.status // "New", "Preparing", "Ready", "Picked Up", "Delivered", "Cancelled"
            };
        });

        res.json({
            success: true,
            outlet: {
                _id: vendor._id,
                name: vendor.name,
                email: vendor.email || "N/A",
                phone: vendor.phone || "N/A",
                city: vendor.city || "Mohali",
                profileImage: vendor.profileImage,
                rating: vendor.rating || 0
            },
            totalAssociatedOrders: totalOrders,
            totalPages: Math.ceil(totalOrders / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            count: associatedOrders.length,
            orders: associatedOrders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🚫 3. GET ALL CANCELLED FOOD ORDERS (WITH REFUND CALCULATION)
// Full Path: GET /admin/food/vendor-orders/cancelled-orders
// ==========================================
const getAllCancelledFoodOrders = async (req, res) => {
    try {
        const { bookingType, foodId, search, page = 1, limit = 20 } = req.query;

        const query = { status: 'Cancelled' };

        if (bookingType) query.bookingType = bookingType;
        if (foodId && mongoose.Types.ObjectId.isValid(foodId)) query.foodId = foodId;

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { cancelReason: regex },
                { "address.name": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodBooking.countDocuments(query);

        const orders = await FoodBooking.find(query)
            .select('_id bookingId status bookingType cancelReason isCouponIssued issuedCouponCode paymentMethod paymentStatus paymentDetails billSummary healthyPlanDetails subscriptionDetails customTiffinDetails items foodId userId refundDetails createdAt updatedAt')
            .populate('userId', 'name phone email profilePic')
            .populate('foodId', 'name city profileImage phone')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        const cancelledList = orders.map(order => {
            let itemSummary = "Food Order";

            if (order.bookingType === 'Direct') {
                const itemNames = (order.items || []).map(i => `${i.name} (x${i.quantity || 1})`);
                itemSummary = itemNames.join(', ') || "Direct Food Order";
            } else if (order.bookingType === 'Healthy Plan') {
                const h = order.healthyPlanDetails || {};
                itemSummary = `${h.title || 'Healthy Diet Plan'} (${h.daysCount || 5} Days - ${h.programType || 'Full Program'})`;
            } else if (order.bookingType === 'Subscription') {
                const s = order.subscriptionDetails || {};
                itemSummary = `${s.planName || 'Standard Tiffin Plan'} (${s.billingCycle || 'weekly'})`;
            } else if (order.bookingType === 'Custom Plate') {
                const c = order.customTiffinDetails || {};
                itemSummary = `Custom 7-Day Plate (${c.packageDays || 10} Days - ${c.dietaryType || 'veg'})`;
            }

            const ref = order.refundDetails || {};

            return {
                _id: order._id,
                bookingId: order.bookingId,
                bookingType: order.bookingType,
                itemSummary,
                cancelReason: order.cancelReason || "No cancellation reason provided.",
                cancelledAt: order.updatedAt,
                createdAt: order.createdAt,

                // 💰 🌟 DYNAMIC PRO-RATA REFUND BREAKDOWN:
                refundInfo: {
                    isRefundApplicable: Boolean(ref.isRefundApplicable),
                    refundAmount: ref.refundAmount || 0,
                    refundStatus: ref.refundStatus || "Not Applicable",
                    totalPaidAmount: ref.totalPaidAmount || order.billSummary?.totalAmount || 0,
                    totalPlanDays: ref.totalPlanDays || 1,
                    consumedDays: ref.consumedDays || 0,
                    remainingDays: ref.remainingDays || 0,
                    refundedAt: ref.refundedAt || null,
                    razorpayRefundId: ref.razorpayRefundId || null
                },

                // 🎁 Compensation Coupon Status
                isCouponIssued: Boolean(order.isCouponIssued),
                issuedCouponCode: order.issuedCouponCode || null,

                // 👤 Customer Info
                customer: {
                    userId: order.userId?._id || null,
                    name: order.userId?.name || "Customer",
                    phone: order.userId?.phone || "N/A",
                    email: order.userId?.email || "N/A",
                    profilePic: order.userId?.profilePic || null
                },

                // 🏪 Kitchen / Vendor Info
                kitchen: {
                    _id: order.foodId?._id || null,
                    name: order.foodId?.name || "Cloud Kitchen",
                    city: order.foodId?.city || "Mohali",
                    phone: order.foodId?.phone || "N/A",
                    profileImage: order.foodId?.profileImage || null
                },

                // 💳 Payment Details
                payment: {
                    paymentMethod: order.paymentMethod || "COD",
                    paymentStatus: order.paymentStatus || "Pending",
                    totalAmount: order.billSummary?.totalAmount || 0,
                    razorpayPaymentId: order.paymentDetails?.razorpayPaymentId || "",
                    paidAt: order.paymentDetails?.paidAt || null
                }
            };
        });

        res.json({
            success: true,
            totalCancelledOrders: totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            limit: parseInt(limit, 10),
            count: cancelledList.length,
            data: cancelledList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💸 4. ADMIN: PROCESS REFUND FOR CANCELLED ORDER (RAZORPAY / MANUAL)
// Full Path: POST /admin/food/vendor-orders/process-refund/:id
// ==========================================
const processAdminFoodRefund = async (req, res) => {
    try {
        const { id } = req.params;
        const { refundNote = "", manualRefundAmount } = req.body;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }], status: 'Cancelled' }
            : { bookingId: id, status: 'Cancelled' };

        const order = await FoodBooking.findOne(query);

        if (!order) {
            return res.status(404).json({ success: false, message: "Cancelled food order not found." });
        }

        if (order.refundDetails?.refundStatus === 'Processed') {
            return res.status(400).json({ 
                success: false, 
                message: `Refund of ₹${order.refundDetails.refundAmount} has already been processed on ${new Date(order.refundDetails.refundedAt).toLocaleString()}.` 
            });
        }

        const payableRefund = manualRefundAmount !== undefined ? Number(manualRefundAmount) : (order.refundDetails?.refundAmount || 0);

        if (payableRefund <= 0) {
            return res.status(400).json({ success: false, message: "Refund amount must be greater than zero." });
        }

        let razorpayRefundData = null;

        // Online Payment Gateway Auto Refund via Razorpay API
        if (order.paymentMethod === 'Online' && order.paymentDetails?.razorpayPaymentId) {
            try {
                razorpayRefundData = await refundRazorpayPayment(
                    order.paymentDetails.razorpayPaymentId,
                    payableRefund,
                    order.bookingId
                );
            } catch (err) {
                order.refundDetails.refundStatus = 'Failed';
                await order.save();
                return res.status(500).json({ 
                    success: false, 
                    message: `Razorpay Refund Failed: ${err.message}` 
                });
            }
        }

        // Update Booking Status
        order.paymentStatus = 'Refunded';
        order.refundDetails = {
            ...order.refundDetails,
            isRefundApplicable: true,
            refundAmount: payableRefund,
            refundStatus: 'Processed',
            refundedAt: new Date(),
            razorpayRefundId: razorpayRefundData ? razorpayRefundData.id : "MANUAL-REFUND",
            refundNote: refundNote || "Refund processed successfully by Admin."
        };

        await order.save();

        res.json({
            success: true,
            message: `Refund of ₹${payableRefund} processed successfully for order ${order.bookingId}!`,
            data: {
                bookingId: order.bookingId,
                paymentStatus: order.paymentStatus,
                refundInfo: order.refundDetails
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getApprovedFoodOutletsList,
    getVendorOrderHistoryModal,
    getAllCancelledFoodOrders,
    processAdminFoodRefund
};