// controllers/admin/CGM/CGMOrderAdmin.js

const CGMOrder = require('../../../models/CGMOrder');
const mongoose = require('mongoose');

// Helper to escape regex special characters (prevents crash on searching '+91...')
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// =========================================================================
// 📋 1. GET ALL ORDERS FOR ADMIN DASHBOARD (LIGHTWEIGHT TABLE VIEW)
// Endpoint: GET /admin/cgm/orders/all
// =========================================================================
const getAllAdminCGMOrders = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            status, 
            paymentStatus, 
            paymentMethod, 
            productType 
        } = req.query;

        // 1. Dynamic Filters
        const query = {};

        if (status) query.status = status;
        if (paymentStatus) query.paymentStatus = paymentStatus;
        if (paymentMethod) query.paymentMethod = paymentMethod;
        if (productType && ['Glucometer', 'CGM'].includes(productType)) {
            query['device.productType'] = productType;
        }

        // 2. Safe Search Filter (Order ID, Customer Name, Phone, ya Product Name)
        if (search && search.trim() !== '') {
            const sanitizedSearch = escapeRegex(search.trim());
            const regex = new RegExp(sanitizedSearch, 'i');
            query.$or = [
                { orderId: regex },
                { 'deliveryAddress.name': regex },
                { 'deliveryAddress.phone': regex },
                { 'device.title': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        // 3. Total Count calculation
        const totalDocs = await CGMOrder.countDocuments(query);

        // 4. Lightweight Projection: Fast dashboard table loading
        const orders = await CGMOrder.find(query)
            .select('_id orderId userId device.title device.productType device.mainImage device.selectedVariant device.unitPrice device.quantity deliveryAddress.name deliveryAddress.phone deliveryAddress.city billSummary.totalPayable paymentMethod paymentStatus status coachConsultation.isIncluded coachConsultation.coachName addons createdAt')
            .populate('userId', 'name phone email profilePic')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // 5. Clean Structured Table Rows for Admin
        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            customer: {
                userId: order.userId?._id || null,
                name: order.deliveryAddress?.name || order.userId?.name || "Customer",
                phone: order.deliveryAddress?.phone || order.userId?.phone || "N/A",
                email: order.userId?.email || "N/A"
            },
            product: {
                title: order.device?.title || "Device",
                productType: order.device?.productType || "Glucometer",
                mainImage: order.device?.mainImage || null,
                variantName: order.device?.selectedVariant?.variantName || "Single Item",
                quantity: order.device?.quantity || 1,
                unitPrice: order.device?.unitPrice || 0
            },
            coach: {
                isIncluded: Boolean(order.coachConsultation?.isIncluded),
                coachName: order.coachConsultation?.coachName || null
            },
            addonsCount: Array.isArray(order.addons) ? order.addons.length : 0,
            city: order.deliveryAddress?.city || "N/A",
            totalAmount: order.billSummary?.totalPayable || 0,
            paymentMethod: order.paymentMethod || "COD",
            paymentStatus: order.paymentStatus || "Pending",
            status: order.status || "Placed",
            orderDate: order.createdAt
        }));

        res.json({
            success: true,
            totalOrders: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedOrders.length,
            data: formattedOrders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 2. GET SINGLE ORDER COMPLETE DETAILS BY ID (FULL VIEW MODAL/PAGE)
// Endpoint: GET /admin/cgm/orders/detail/:id
// =========================================================================
const getAdminCGMOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        // MongoDB _id ya Custom orderId (e.g. HK-CGM-104928) dono se search karega
        const query = mongoose.Types.ObjectId.isValid(id) 
            ? { $or: [{ _id: id }, { orderId: id }] }
            : { orderId: id };

        const order = await CGMOrder.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob')
            .populate('device.deviceId', 'title brand mainImage deviceModel glucometerConfig cgmConfig userManualPdf')
            .populate('addons.addonId', 'name price description imageUrl')
            .populate('coachConsultation.coachId', 'name qualification coachType profileImage phone email price') // 👈 Fixed: Correct field & model
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        res.json({
            success: true,
            data: order //  100% complete details for admin modal
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🚫 3. GET ALL CANCELLED ORDERS FOR ADMIN DASHBOARD
// Endpoint: GET /admin/cgm/orders/cancelled
// =========================================================================
const getAllCancelledAdminCGMOrders = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            productType, 
            paymentMethod, 
            paymentStatus 
        } = req.query;

        // Base Filter: Strictly Cancelled Orders
        const query = { status: 'Cancelled' };

        if (productType && ['Glucometer', 'CGM'].includes(productType)) {
            query['device.productType'] = productType;
        }
        if (paymentMethod) query.paymentMethod = paymentMethod;
        if (paymentStatus) query.paymentStatus = paymentStatus;

        // Search Filter (Order ID, Customer Name, Phone, ya Product Title)
        if (search && search.trim() !== '') {
            const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            const regex = new RegExp(escapeRegex(search.trim()), 'i');
            query.$or = [
                { orderId: regex },
                { 'deliveryAddress.name': regex },
                { 'deliveryAddress.phone': regex },
                { 'device.title': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await CGMOrder.countDocuments(query);

        const orders = await CGMOrder.find(query)
            .select('_id orderId userId device.title device.productType device.mainImage device.selectedVariant device.unitPrice device.quantity deliveryAddress.name deliveryAddress.phone deliveryAddress.city billSummary.totalPayable paymentMethod paymentStatus status coachConsultation.isIncluded coachConsultation.coachName addons trackingTimeline createdAt updatedAt')
            .populate('userId', 'name phone email profilePic')
            .sort({ updatedAt: -1 }) // Most recently cancelled on TOP
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Clean Format for Admin Cancelled Orders Table
        const cancelledOrders = orders.map(order => {
            // Find cancellation log and reason from timeline
            const cancelLog = (order.trackingTimeline || [])
                .slice()
                .reverse()
                .find(t => t.status === 'Cancelled');

            const cancelReason = cancelLog?.note 
                ? cancelLog.note.replace('Order cancelled by user. Reason: ', '') 
                : "Cancelled by user before dispatch.";

            return {
                _id: order._id,
                orderId: order.orderId,
                customer: {
                    userId: order.userId?._id || null,
                    name: order.deliveryAddress?.name || order.userId?.name || "Customer",
                    phone: order.deliveryAddress?.phone || order.userId?.phone || "N/A",
                    email: order.userId?.email || "N/A"
                },
                product: {
                    title: order.device?.title || "Device",
                    productType: order.device?.productType || "Glucometer",
                    mainImage: order.device?.mainImage || null,
                    variantName: order.device?.selectedVariant?.variantName || "Single Item",
                    quantity: order.device?.quantity || 1,
                    unitPrice: order.device?.unitPrice || 0
                },
                cancelReason,
                cancelledAt: cancelLog?.timestamp || order.updatedAt,
                city: order.deliveryAddress?.city || "N/A",
                totalAmount: order.billSummary?.totalPayable || 0,
                payment: {
                    paymentMethod: order.paymentMethod || "COD",
                    paymentStatus: order.paymentStatus || "Pending",
                    isRefunded: order.paymentStatus === 'Refunded'
                },
                coach: {
                    isIncluded: Boolean(order.coachConsultation?.isIncluded),
                    coachName: order.coachConsultation?.coachName || null
                },
                addonsCount: Array.isArray(order.addons) ? order.addons.length : 0,
                orderDate: order.createdAt
            };
        });

        res.json({
            success: true,
            totalCancelledOrders: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: cancelledOrders.length,
            data: cancelledOrders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 4. GET SINGLE CANCELLED ORDER FULL DETAILS BY ID FOR ADMIN
// Endpoint: GET /admin/cgm/orders/cancelled/:id
// =========================================================================
const getAdminCancelledCGMOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        // MongoDB _id ya Custom orderId (e.g. HK-CGM-992905) dono se search karega + strictly Cancelled check
        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { orderId: id }], status: 'Cancelled' }
            : { orderId: id, status: 'Cancelled' };

        const order = await CGMOrder.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob')
            .populate('device.deviceId', 'title brand mainImage deviceModel glucometerConfig cgmConfig userManualPdf')
            .populate('addons.addonId', 'name price description imageUrl')
            .populate('coachConsultation.coachId', 'name qualification coachType profileImage phone email price')
            .lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Cancelled order not found."
            });
        }

        // Timeline se cancellation log aur reason extract karein
        const cancelLog = (order.trackingTimeline || [])
            .slice()
            .reverse()
            .find(t => t.status === 'Cancelled');

        const cancelReason = cancelLog?.note 
            ? cancelLog.note.replace('Order cancelled by user. Reason: ', '') 
            : "Cancelled by user before dispatch.";

        res.json({
            success: true,
            cancellationSummary: {
                isCancelled: true,
                cancelledAt: cancelLog?.timestamp || order.updatedAt,
                cancelReason: cancelReason,
                refundStatus: order.paymentStatus === 'Refunded' ? 'Refunded' : (order.paymentMethod === 'Online' ? 'Refund-Pending' : 'Not Applicable (COD)')
            },
            data: {
                ...order,
                cancelReason
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getAllAdminCGMOrders,
    getAdminCGMOrderById,
    getAllCancelledAdminCGMOrders,
    getAdminCancelledCGMOrderById
};