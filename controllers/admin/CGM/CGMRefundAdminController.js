// controllers/admin/CGM/CGMRefundAdminController.js

const CGMOrder = require('../../../models/CGMOrder');
const { refundRazorpayPayment } = require('../../../utils/razorpay');
const mongoose = require('mongoose');

// Helper to escape regex special characters
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// =========================================================================
// 📋 1. GET REFUND QUEUE (LIST OF ORDERS REQUIRING REFUND)
// Endpoint: GET /admin/cgm/refunds/queue
// =========================================================================
const getAdminRefundQueue = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            refundStatus = "Pending" 
        } = req.query;

        // Base Filter: Only Cancelled orders where refund is applicable
        const query = { 
            status: 'Cancelled',
            'refundDetails.isRefundApplicable': true 
        };

        if (refundStatus && refundStatus !== 'all') {
            query['refundDetails.refundStatus'] = refundStatus; // 'Pending', 'Processed', 'Failed'
        }

        // Search Filter
        if (search && search.trim() !== '') {
            const regex = new RegExp(escapeRegex(search.trim()), 'i');
            query.$or = [
                { orderId: regex },
                { 'deliveryAddress.name': regex },
                { 'deliveryAddress.phone': regex },
                { transactionId: regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await CGMOrder.countDocuments(query);

        const orders = await CGMOrder.find(query)
            .select('_id orderId userId device.title device.productType device.mainImage deliveryAddress.name deliveryAddress.phone billSummary.totalPayable paymentMethod paymentStatus transactionId refundDetails createdAt updatedAt')
            .populate('userId', 'name phone email')
            .populate('refundDetails.processedBy', 'name email')
            .sort({ updatedAt: -1 }) // Latest cancellation on TOP
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Format clean table list for Admin Refund Dashboard
        const formattedQueue = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            customer: {
                userId: order.userId?._id || null,
                name: order.deliveryAddress?.name || order.userId?.name || "Customer",
                phone: order.deliveryAddress?.phone || order.userId?.phone || "N/A",
                email: order.userId?.email || "N/A"
            },
            productTitle: order.device?.title || "Device",
            productType: order.device?.productType || "Glucometer",
            totalPaidAmount: order.refundDetails?.totalPaidAmount || order.billSummary?.totalPayable || 0,
            refundAmount: order.refundDetails?.refundAmount || order.billSummary?.totalPayable || 0, // 100%
            cancelledBy: order.refundDetails?.cancelledBy || "User",
            penaltyApplied: order.refundDetails?.penaltyCharge || 0,
            refundStatus: order.refundDetails?.refundStatus || "Pending",
            paymentMethod: order.paymentMethod,
            transactionId: order.transactionId,
            razorpayRefundId: order.refundDetails?.razorpayRefundId || null,
            refundedAt: order.refundDetails?.refundedAt || null,
            processedBy: order.refundDetails?.processedBy?.name || null,
            refundNote: order.refundDetails?.refundNote || "",
            cancelledDate: order.updatedAt
        }));

        res.json({
            success: true,
            totalPendingRefunds: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedQueue.length,
            data: formattedQueue
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 💸 2. ADMIN PROCESS 100% REFUND (RAZORPAY API / MANUAL)
// Endpoint: POST /admin/cgm/refunds/process/:id
// =========================================================================
const processAdminCGMRefund = async (req, res) => {
    try {
        const { id } = req.params;
        const { refundNote = "" } = req.body;
        const adminId = req.user?.id || req.user?._id;

        // Find cancelled order
        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { orderId: id }], status: 'Cancelled' }
            : { orderId: id, status: 'Cancelled' };

        const order = await CGMOrder.findOne(query);

        if (!order) {
            return res.status(404).json({ success: false, message: "Cancelled order not found." });
        }

        // Check if already refunded
        if (order.refundDetails?.refundStatus === 'Processed') {
            return res.status(400).json({
                success: false,
                message: `Refund of ₹${order.refundDetails.refundAmount} has already been processed on ${new Date(order.refundDetails.refundedAt).toLocaleString()}.`
            });
        }

        // 100% Refund calculation (Full Paid Amount)
        const payableRefund = Number(order.refundDetails?.refundAmount) || Number(order.billSummary?.totalPayable) || 0;

        if (payableRefund <= 0) {
            return res.status(400).json({ success: false, message: "Refund amount must be greater than zero." });
        }

        let razorpayRefundData = null;

        // 🚀 Execute Razorpay Payout Refund if paid online
        if (order.paymentMethod === 'Online' && order.transactionId) {
            try {
                razorpayRefundData = await refundRazorpayPayment(
                    order.transactionId,
                    payableRefund,
                    order.orderId
                );
            } catch (err) {
                console.error("Razorpay Refund API Failure:", err);
                order.refundDetails.refundStatus = 'Failed';
                await order.save();
                return res.status(500).json({
                    success: false,
                    message: `Razorpay Refund Failed: ${err.message}`
                });
            }
        }

        // Update Order & Refund Status
        order.paymentStatus = 'Refunded';
        order.refundDetails = {
            ...order.refundDetails,
            isRefundApplicable: true,
            refundAmount: payableRefund, // 100% Refund
            totalPaidAmount: payableRefund,
            penaltyCharge: 0,
            cancelledBy: order.refundDetails?.cancelledBy || 'User',
            refundStatus: 'Processed',
            refundedAt: new Date(),
            razorpayRefundId: razorpayRefundData ? razorpayRefundData.id : "MANUAL-PROCESSED",
            refundNote: refundNote || "100% Refund processed successfully by Admin.",
            processedBy: adminId || null
        };

        order.trackingTimeline.push({
            status: 'Refunded',
            timestamp: new Date(),
            note: `100% Refund of ₹${payableRefund} processed successfully by Admin (Refund ID: ${order.refundDetails.razorpayRefundId}).`
        });

        await order.save();

        res.json({
            success: true,
            message: `100% refund of ₹${payableRefund} processed successfully for order ${order.orderId}!`,
            orderId: order.orderId,
            refundAmount: payableRefund,
            paymentStatus: order.paymentStatus,
            refundDetails: order.refundDetails
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAdminRefundQueue,
    processAdminCGMRefund
};