// controllers/provider/Food/VendorTiffinOrderController.js

const FoodBooking = require('../../../models/FoodBooking');

// ==========================================
// 🍱 1. GET ALL VENDOR STANDARD SUBSCRIPTIONS (List View)
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

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalDocs = await FoodBooking.countDocuments(query);

        const subscriptions = await FoodBooking.find(query)
            .populate('userId', 'name phone email profilePic')
            .populate('driverId', 'name phone vehicleType vehicleNumber')
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
            count: subscriptions.length,
            data: subscriptions
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
        .populate('subscriptionDetails.dailyMealSchedule.mealId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
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
            data: subscription
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🎨 3. GET ALL CUSTOM TIFFIN REQUESTS (Incoming Custom Packages)
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

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalDocs = await FoodBooking.countDocuments(query);

        const customRequests = await FoodBooking.find(query)
            .populate('userId', 'name phone email profilePic')
            .populate('customTiffinDetails.selectedFoods.breakfast.mealId', 'name imageUrl price calories dietType')
            .populate('customTiffinDetails.selectedFoods.lunch.mealId', 'name imageUrl price calories dietType')
            .populate('customTiffinDetails.selectedFoods.dinner.mealId', 'name imageUrl price calories dietType')
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
            count: customRequests.length,
            data: customRequests
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
        .populate('customTiffinDetails.selectedFoods.breakfast.mealId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('customTiffinDetails.selectedFoods.lunch.mealId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('customTiffinDetails.selectedFoods.dinner.mealId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
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
            data: customOrder
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
            customOrder.status = 'Active'; // Kitchen accepts & activates meal preparation cycle
            await customOrder.save();

            return res.json({
                success: true,
                message: `Custom Tiffin package (${customOrder.bookingId}) accepted successfully!`,
                data: {
                    bookingId: customOrder.bookingId,
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