// controllers/provider/Food/FoodOrderController.js

const FoodBooking = require('../../../models/FoodBooking');
const Food = require('../../../models/Food');

// ==========================================
// 📦 1. GET ALL VENDOR ORDERS (Filtered & Paginated)
// Full Path: GET /provider/food/orders/my-orders
// ==========================================
const getVendorOrders = async (req, res) => {
    try {
        const vendorId = req.user.id; // Logged-in vendor ID from protect('provider')
        const { status, bookingType, search, page = 1, limit = 20 } = req.query;

        const query = { foodId: vendorId };

        // 1. Status Filter (E.g. ?status=New ya ?status=Preparing)
        if (status) {
            query.status = status;
        }

        // 2. Booking Type Filter (E.g. ?bookingType=Subscription ya ?bookingType=Direct)
        if (bookingType) {
            query.bookingType = bookingType;
        }

        // 3. Search Filter (by Booking ID or Customer Phone/Name inside address)
        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { "address.name": regex },
                { "address.phone": regex }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalDocs = await FoodBooking.countDocuments(query);

        // Fetch Orders with essential populates
        const orders = await FoodBooking.find(query)
            .populate('userId', 'name phone email profilePic')
            .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status')
            .populate('addons.addonId', 'name price imageUrl')
            .populate('billSummary.couponId', 'couponName discountPercentage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit)),
            currentPage: parseInt(page),
            limit: parseInt(limit),
            count: orders.length,
            data: orders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 2. GET SINGLE VENDOR ORDER FULL DETAILS BY ID
// Full Path: GET /provider/food/orders/:id
// ==========================================
const getVendorOrderById = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;

        // 🚨 Strict Security: Orders strictly filtered by foodId: vendorId (Tenant Guard)
        const order = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId
        })
        .populate('userId', 'name phone email gender profilePic dob')
        .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status location')
        .populate('addons.addonId', 'name price description imageUrl')
        .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Order not found or you are not authorized to view this order." 
            });
        }

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🔄 3. UPDATE ORDER STATUS (Kitchen Vendor Restricted: Preparing / Ready / Cancelled)
// Full Path: PATCH /provider/food/orders/:id/status
// ==========================================
const updateVendorOrderStatus = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const { id } = req.params;
        let { status, cancelReason } = req.body;

        // "Ready for delivery" ko standard DB enum "Ready" me normalize karein
        if (status === 'Ready for Delivery' || status === 'Ready for delivery') {
            status = 'Ready';
        }

        // 🚨 1. VENDOR PERMISSION GUARD:
        // Vendor sirf Preparing, Ready ya Cancelled hi kar sakta hai
        const VENDOR_PERMITTED_STATUSES = ['Preparing', 'Ready', 'Cancelled'];

        if (!VENDOR_PERMITTED_STATUSES.includes(status)) {
            return res.status(403).json({
                success: false,
                message: `Permission Denied: Vendors are only permitted to update order status to 'Preparing', 'Ready', or 'Cancelled'. 'Picked Up' and 'Delivered' are updated by the delivery driver.`
            });
        }

        // 🚨 2. KITCHEN STATE MACHINE TRANSITIONS:
        const allowedTransitions = {
            'New': ['Preparing', 'Cancelled'],
            'Preparing': ['Ready', 'Cancelled'],
            'Ready': ['Cancelled'], // Ready hone ke baad driver pick karega
            'Picked Up': [],
            'Delivered': [],
            'Cancelled': []
        };

        const order = await FoodBooking.findOne({
            $or: [{ _id: id }, { bookingId: id }],
            foodId: vendorId
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Order not found or not assigned to your kitchen." 
            });
        }

        // Validate Sequential State Transition
        const validNextStates = allowedTransitions[order.status] || [];
        if (!validNextStates.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid state transition: Cannot change order status from '${order.status}' to '${status}'.`
            });
        }

        order.status = status;
        if (status === 'Cancelled' && cancelReason) {
            order.cancelReason = cancelReason;
        }

        await order.save();

        res.json({
            success: true,
            message: `Order status updated to '${status}' successfully!`,
            data: {
                bookingId: order.bookingId,
                status: order.status,
                updatedAt: order.updatedAt
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getVendorOrders,
    getVendorOrderById,
    updateVendorOrderStatus
};