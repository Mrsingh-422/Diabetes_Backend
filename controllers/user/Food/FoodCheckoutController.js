// controllers/user/Food/FoodCheckoutController.js

const Cart = require('../../../models/Cart');
const Food = require('../../../models/Food');
const FoodService = require('../../../models/FoodService'); 
const FoodComboOffer = require('../../../models/FoodComboOffer'); 
const FoodBooking = require('../../../models/FoodBooking');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const FoodAddon = require('../../../models/FoodAddon'); 
const CodConfig = require('../../../models/CodConfig');
const { deleteFile } = require('../../../utils/fileHandler');

const crypto = require('crypto');
const { 
    createRazorpayOrder, 
    verifyRazorpaySignature, 
    fetchAndMapRazorpayPayment 
} = require('../../../utils/razorpay');

// ==========================================
// 💡 HAVERSINE DISTANCE CALCULATOR
// ==========================================
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
};

// ==========================================
// 💡 SECURE BILLING ENGINE (WITH LOCATION-BASED DELIVERY CHARGES)
// ==========================================
const calculateFoodBillHelper = async ({ 
    userId, 
    foodId, 
    items = [], 
    addons = [], 
    address = null,      // 👈 User Delivery Address Object
    userLat, 
    userLng, 
    couponCode, 
    isRapid = false 
}) => {
    let itemTotal = 0;
    const verifiedItems = [];
    const verifiedAddons = [];

    const cleanFoodId = foodId?._id ? foodId._id.toString() : foodId.toString();

    // 1. Verify Meals & Combos from DB
    for (let item of items) {
        let price = 0;
        let name = '';
        let resolvedProductType = 'MealItem';

        const rawItemId = item.itemId?._id ? item.itemId._id.toString() : (item.itemId ? item.itemId.toString() : item._id.toString());
        const isCombo = item.productType === 'Combo' || item.itemType === 'FoodComboOffer';

        if (isCombo) {
            const combo = await FoodComboOffer.findById(rawItemId);
            if (!combo || !combo.isActive) throw new Error(`Combo bundle is currently unavailable.`);
            price = combo.comboPrice;
            name = combo.name;
            resolvedProductType = 'Combo';
        } else {
            const meal = await FoodService.findById(rawItemId);
            if (!meal || !meal.isActive) throw new Error(`Dish is currently unavailable.`);
            price = meal.discountPrice > 0 ? meal.discountPrice : meal.price;
            name = meal.name;
            resolvedProductType = 'MealItem';
        }

        const qty = Math.max(1, Number(item.quantity || 1));
        itemTotal += (price * qty);

        verifiedItems.push({
            productType: resolvedProductType,
            itemId: rawItemId,
            name,
            price,
            quantity: qty,
            mealType: item.mealType || 'Single Meal',
            isComboApplied: Boolean(item.isComboApplied),
            comboOfferId: item.comboOfferId || null
        });
    }

    // 2. Non-Food Addons Calculation
    if (addons && Array.isArray(addons) && addons.length > 0) {
        for (let add of addons) {
            const rawAddonId = add.addonId?._id || add.addonId || add._id;
            const addonDoc = await FoodAddon.findById(rawAddonId);

            if (addonDoc) {
                const addPrice = Number(addonDoc.price || 0);
                const addQty = Math.max(1, Number(add.quantity || 1));
                itemTotal += (addPrice * addQty);

                verifiedAddons.push({
                    addonId: addonDoc._id,
                    name: addonDoc.name,
                    price: addPrice,
                    quantity: addQty
                });
            }
        }
    }

    // 3. Kitchen Status Check
    const vendor = await Food.findById(cleanFoodId);
    if (!vendor) throw new Error("Kitchen vendor not found.");
    if (vendor.isActive === false) throw new Error("This kitchen is currently suspended by Admin.");
    if (vendor.isOnline === false) throw new Error("Booking Blocked: Kitchen is currently offline and not accepting orders.");

    // 4. COD Availability Policy Check
    const codSetting = await CodConfig.findOne({ vendorType: 'Food' });
    const isCodAvailable = codSetting ? Boolean(codSetting.isCodAvailable) : true;

    // 5. 📍 LOCATION-BASED DELIVERY CHARGES RESOLUTION
    let parsedAddress = address;
    if (typeof address === 'string') {
        try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = null; }
    }

    const userCity = parsedAddress?.city ? parsedAddress.city.trim() : null;
    const userState = parsedAddress?.state ? parsedAddress.state.trim() : null;

    let chargesConfig = null;

    // A. Priority 1: Match Exact City (e.g. Mohali / New Delhi)
    if (userCity) {
        chargesConfig = await DeliveryCharge.findOne({
            vendorType: 'Food',
            city: new RegExp(`^${userCity}$`, 'i'),
            isAdminGlobal: true
        });
    }

    // B. Priority 2: Match State (e.g. Punjab / Delhi)
    if (!chargesConfig && userState) {
        chargesConfig = await DeliveryCharge.findOne({
            vendorType: 'Food',
            state: new RegExp(`^${userState}$`, 'i'),
            city: null,
            isAdminGlobal: true
        });
    }

    // C. Priority 3: Specific Vendor's Custom Delivery Rates (if configured)
    if (!chargesConfig) {
        chargesConfig = await DeliveryCharge.findOne({ vendorId: cleanFoodId });
    }

    // D. Priority 4: Platform Global Fallback Rate
    if (!chargesConfig) {
        chargesConfig = await DeliveryCharge.findOne({ 
            vendorType: 'Food', 
            isAdminGlobal: true, 
            city: null, 
            state: null 
        }) || await DeliveryCharge.findOne({ vendorType: 'Food', isAdminGlobal: true });
    }

    // E. Priority 5: In-Memory Default Safety
    const finalCharges = chargesConfig || {
        fixedPrice: 40,
        fixedDistance: 5,
        pricePerKM: 10,
        rapidCharge: 25,
        fastDeliveryExtra: 25,
        packagingCharge: 15,
        freeDeliveryThreshold: 500,
        taxPercentage: 5,
        isRapidAvailable: true
    };

    const fixedPrice = finalCharges.fixedPrice ?? 40;
    const fixedDistance = finalCharges.fixedDistance ?? 5;
    const pricePerKM = finalCharges.pricePerKM ?? 10;
    const packagingCharge = finalCharges.packagingCharge ?? 15;
    const rapidCharge = finalCharges.rapidCharge ?? finalCharges.fastDeliveryExtra ?? 25;
    const freeDeliveryThreshold = finalCharges.freeDeliveryThreshold ?? 500;
    const taxPercentage = finalCharges.taxPercentage ?? 5;
    const isRapidAvailable = finalCharges.isRapidAvailable !== false;

    let deliveryCharge = 0;
    let distance = 0;

    // Distance Calculation & Delivery Fee Computation
    if (userLat && userLng && vendor.location?.lat && vendor.location?.lng) {
        distance = calculateDistance(Number(userLat), Number(userLng), Number(vendor.location.lat), Number(vendor.location.lng));

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Food', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 10;
        if (distance > maxRadius) {
            throw new Error(`Your address is ${distance} km away. Maximum delivery radius is ${maxRadius} km.`);
        }

        if (itemTotal >= freeDeliveryThreshold) {
            deliveryCharge = 0;
        } else {
            if (distance <= fixedDistance) {
                deliveryCharge = fixedPrice;
            } else {
                const extraKm = distance - fixedDistance;
                deliveryCharge = fixedPrice + (extraKm * pricePerKM);
            }
        }
    } else {
        // Flat Fixed Delivery Price fallback if coordinates not passed
        deliveryCharge = (itemTotal >= freeDeliveryThreshold) ? 0 : fixedPrice;
    }

    // Rapid Delivery Extra Surcharge
    let appliedRapidFee = 0;
    if (isRapid) {
        if (!isRapidAvailable) {
            throw new Error("Rapid express delivery is currently not available for this location/kitchen.");
        }
        appliedRapidFee = rapidCharge;
        deliveryCharge += appliedRapidFee;
    }

    // 6. Coupon Verification
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
                { vendorId: cleanFoodId, vendorType: 'Food' },
                { isAdminCreated: true, vendorType: { $in: ['Food', 'All'] } }
            ]
        });

        if (!coupon) throw new Error(`Coupon '${cleanCode}' is invalid or expired.`);
        if (itemTotal < (coupon.minOrderAmount || 0)) throw new Error(`Minimum order of ₹${coupon.minOrderAmount} required for '${cleanCode}'.`);

        if (userId && coupon.usedBy) {
            const userUsage = coupon.usedBy.find(u => u.userId?.toString() === userId.toString());
            if (userUsage && userUsage.usageCount >= (coupon.maxUsagePerUser || 1)) {
                throw new Error(`Coupon usage limit reached for '${cleanCode}'.`);
            }
        }

        couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
        validCouponId = coupon._id;
    }

    // 7. Tax Assessment (GST)
    const taxableSubtotal = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge);
    const taxAmount = Math.round(taxableSubtotal * (taxPercentage / 100));
    const totalAmount = Math.max(0, (itemTotal - couponDiscount) + deliveryCharge + packagingCharge + taxAmount);

    return {
        verifiedItems,
        verifiedAddons,
        vendor,
        distance,
        isCodAvailable,
        isRapidAvailable,
        appliedLocation: {
            city: userCity || "Global Fallback",
            state: userState || "Global Fallback"
        },
        billSummary: {
            itemTotal: Math.round(itemTotal),
            deliveryCharge: Math.round(deliveryCharge),
            packagingCharge: Math.round(packagingCharge),
            rapidCharge: Math.round(appliedRapidFee),
            fastDeliveryCharge: Math.round(appliedRapidFee),
            taxAmount: Math.round(taxAmount),
            taxPercentage: taxPercentage,
            
            // 🚨 Breakdown Parameters Snapshot:
            fixedPrice: fixedPrice,
            fixedDistance: fixedDistance,
            pricePerKM: pricePerKM,
            freeDeliveryThreshold: freeDeliveryThreshold,
            isRapidAvailable: isRapidAvailable,

            couponDiscount: Math.round(couponDiscount),
            couponId: validCouponId,
            totalAmount: Math.round(totalAmount),
            noShowFeeApplied: 0
        }
    };
};

// ==========================================
// 1. BILL PREVIEW (POST /calculate)
// ==========================================
const calculateCheckoutBill = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            items, 
            addons, 
            address,      // 👈 Address passed from frontend
            userLat, 
            userLng, 
            couponCode, 
            isRapid 
        } = req.body;

        let cartItems = items;
        let targetFoodId = foodId;

        if (!cartItems || cartItems.length === 0) {
            const cart = await Cart.findOne({ userId });
            if (!cart || !cart.foodCart || cart.foodCart.items.length === 0) {
                return res.status(400).json({ success: false, message: "Your food cart is empty." });
            }
            cartItems = cart.foodCart.items;
            targetFoodId = cart.foodCart.foodId;
        }

        if (!targetFoodId) {
            return res.status(400).json({ success: false, message: "Kitchen vendor ID (foodId) is required." });
        }

        const calculation = await calculateFoodBillHelper({
            userId,
            foodId: targetFoodId,
            items: cartItems,
            addons: addons || [],
            address: address || null, // 👈 Location evaluated here
            userLat,
            userLng,
            couponCode,
            isRapid: isRapid === true
        });

        res.json({
            success: true,
            distance: `${calculation.distance} km`,
            appliedLocation: calculation.appliedLocation,
            orderRestrictions: {
                isCodAvailable: calculation.isCodAvailable,
                isRapidAvailable: calculation.isRapidAvailable
            },
            billSummary: calculation.billSummary,
            items: calculation.verifiedItems,
            addons: calculation.verifiedAddons
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. PLACE ORDER (POST /place-order)
// ==========================================
const placeFoodOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            foodId, 
            items, 
            addons,
            bookingType = 'Direct',
            subscriptionDetails,
            customPlateSchedule,
            address, 
            userLat, 
            userLng, 
            couponCode, 
            deliverySlot,
            isRapid = false,
            paymentMethod = 'COD'
        } = req.body;

        const activePaymentMethod = paymentMethod || 'COD';

        // Parse address safely
        let parsedAddress = address;
        if (typeof address === 'string') {
            try {
                parsedAddress = JSON.parse(address);
            } catch (e) {
                parsedAddress = null;
            }
        }

        if (!parsedAddress || !parsedAddress.name || !parsedAddress.phone || !parsedAddress.houseNo || !parsedAddress.city || !parsedAddress.pincode) {
            return res.status(400).json({ success: false, message: "Complete delivery address with phone and pincode is required." });
        }

        let cartItems = items;
        let targetFoodId = foodId;

        if (!cartItems || cartItems.length === 0) {
            const cart = await Cart.findOne({ userId });
            if (!cart || !cart.foodCart || cart.foodCart.items.length === 0) {
                return res.status(400).json({ success: false, message: "Transaction expired. Cart is empty." });
            }
            cartItems = cart.foodCart.items;
            targetFoodId = cart.foodCart.foodId;
        }

        const cleanFoodId = targetFoodId?._id ? targetFoodId._id.toString() : targetFoodId.toString();

        const calculation = await calculateFoodBillHelper({
            userId,
            foodId: cleanFoodId,
            items: cartItems,
            addons: addons || [],
            address: parsedAddress, // 👈 Pass address object directly
            userLat,
            userLng,
            couponCode,
            isRapid: isRapid === true
        });

        // COD Enforcement Check
        if (activePaymentMethod === 'COD' && calculation.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled for food orders. Please pay online to complete your checkout."
            });
        }

        const tempBookingId = `ORD-FD-${Math.floor(100000 + Math.random() * 900000)}`;
        const deliveryOTP = String(Math.floor(1000 + Math.random() * 9000));

        let rzpOrder = null;

        // Online Razorpay Flow
        if (activePaymentMethod !== 'COD') {
            const payableAmountInRupees = Math.max(1, calculation.billSummary.totalAmount);
            rzpOrder = await createRazorpayOrder(
                payableAmountInRupees, 
                `rcpt_${tempBookingId}_${Date.now()}`
            );
        }
        
        // Create Booking in DB
        const booking = await FoodBooking.create({
            bookingId: tempBookingId,
            userId,
            foodId: cleanFoodId,
            bookingType,
            items: calculation.verifiedItems,
            addons: calculation.verifiedAddons,
            subscriptionDetails,
            customPlateSchedule,
            address: parsedAddress,
            deliverySlot: deliverySlot || "Immediate (30-45 mins)",
            isRapid: isRapid === true,
            billSummary: calculation.billSummary,
            paymentMethod: activePaymentMethod,
            paymentStatus: 'Pending',
            status: 'New',
            deliveryOTP,
            paymentDetails: {
                razorpayOrderId: rzpOrder ? rzpOrder.id : ""
            }
        });

        // COD Post-Order Actions
        if (activePaymentMethod === 'COD') {
            if (calculation.billSummary.couponId) {
                await Coupon.findByIdAndUpdate(calculation.billSummary.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

            await Cart.findOneAndUpdate(
                { userId },
                { $set: { "foodCart.items": [], "foodCart.foodId": null } }
            );

            return res.status(201).json({
                success: true,
                isOnlinePayment: false,
                message: "Food order placed successfully (COD)!",
                data: booking
            });
        }

        // Online Post-Order Actions
        const rawKey = process.env.RAZORPAY_KEY_ID || "rzp_test_T2f3swDLdaDZCP";
        const razorpayKey = rawKey.replace(/["']/g, "").trim();

        res.status(201).json({
            success: true,
            isOnlinePayment: true,
            message: "Razorpay order created for food checkout.",
            key: razorpayKey,
            key_id: razorpayKey,
            keyId: razorpayKey,
            amount: rzpOrder.amount,
            amountInRupees: calculation.billSummary.totalAmount,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            orderId: rzpOrder.id,
            bookingId: booking.bookingId,
            appointmentId: booking._id,
            data: {
                ...booking._doc,
                key: razorpayKey,
                key_id: razorpayKey,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                appointmentId: booking._id
            }
        });

    } catch (error) {
        console.error("placeFoodOrder Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. VERIFY PAYMENT (POST /verify-payment)
// ==========================================
const verifyFoodPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            appointmentId, 
            bookingId, 
            orderId,
            razorpayOrderId, 
            razorpay_order_id, 
            razorpayPaymentId, 
            razorpay_payment_id, 
            razorpaySignature, 
            razorpay_signature 
        } = req.body;

        const targetId = appointmentId || bookingId || orderId;
        const rzpOrderId = razorpayOrderId || razorpay_order_id;
        const rzpPaymentId = razorpayPaymentId || razorpay_payment_id;
        const rzpSignature = razorpaySignature || razorpay_signature;

        if (!targetId || !rzpOrderId || !rzpPaymentId || !rzpSignature) {
            return res.status(400).json({ success: false, message: "Missing payment verification tokens." });
        }

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

        const order = await FoodBooking.findOne({
            $or: [
                { _id: targetId },
                { bookingId: targetId },
                { "paymentDetails.razorpayOrderId": rzpOrderId }
            ],
            userId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        let rzpDetails = null;
        try {
            rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
        } catch (e) {
            rzpDetails = null;
        }

        order.paymentStatus = 'Paid';
        order.paymentMethod = 'Online';
        order.paymentDetails = rzpDetails || {
            razorpayPaymentId: rzpPaymentId,
            razorpayOrderId: rzpOrderId,
            razorpaySignature: rzpSignature,
            paidAt: new Date()
        };

        await order.save();

        if (order.billSummary?.couponId) {
            await Coupon.findByIdAndUpdate(order.billSummary.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        await Cart.findOneAndUpdate(
            { userId },
            { $set: { "foodCart.items": [], "foodCart.foodId": null } }
        );

        res.json({
            success: true,
            message: "Payment verified successfully & food order confirmed!",
            data: order
        });

    } catch (error) {
        console.error("verifyFoodPayment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET MY ORDERS (GET /my-orders)
// ==========================================
const getMyFoodOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status } = req.query;

        const query = { userId };
        if (status) query.status = status;

        // 🚨 Sirf UI Card ke liye zaroori fields select kiye gaye hain
        const orders = await FoodBooking.find(query)
            .select('_id bookingId createdAt status deliveryOTP paymentStatus paymentMethod billSummary.totalAmount foodId')
            .populate('foodId', 'name profileImage address city')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            count: orders.length,
            data: orders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. GET SINGLE ORDER BY ID (GET /order/:id)
// ==========================================
const getSingleFoodOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // 🚨 Supports both MongoDB _id and custom bookingId (e.g. ORD-FD-281415)
        const order = await FoodBooking.findOne({ 
            $or: [{ _id: id }, { bookingId: id }], 
            userId 
        })
        .populate('foodId', 'name profileImage address city state phone rating location')
        .populate('driverId', 'name phone vehicleType vehicleNumber profilePic status')
        .populate('addons.addonId', 'name price imageUrl description')
        .populate('billSummary.couponId', 'couponName discountPercentage maxDiscount')
        .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order details not found." });
        }

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// --- ADDONS CRUD CONTROLLERS ---
const createFoodAddon = async (req, res) => {
    try {
        const { name, price, description } = req.body;
        if (!name || price === undefined) {
            return res.status(400).json({ success: false, message: "Add-on name and price are required." });
        }
        const imagePath = req.file ? `/uploads/foods/addons/${req.file.filename}` : null;
        const newAddon = await FoodAddon.create({
            name,
            price: Number(price),
            description: description || "",
            imageUrl: imagePath
        });
        res.status(201).json({ success: true, message: "Add-on created successfully!", data: newAddon });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateFoodAddon = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, description } = req.body;
        const addon = await FoodAddon.findById(id);
        if (!addon) return res.status(404).json({ success: false, message: "Add-on not found." });

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (price !== undefined) updateData.price = Number(price);
        if (description !== undefined) updateData.description = description;

        if (req.file) {
            if (addon.imageUrl) deleteFile(addon.imageUrl);
            updateData.imageUrl = `/uploads/foods/addons/${req.file.filename}`;
        }

        const updated = await FoodAddon.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        res.json({ success: true, message: "Add-on updated successfully!", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteFoodAddon = async (req, res) => {
    try {
        const { id } = req.params;
        const addon = await FoodAddon.findById(id);
        if (!addon) return res.status(404).json({ success: false, message: "Add-on not found." });
        if (addon.imageUrl) deleteFile(addon.imageUrl);
        await FoodAddon.findByIdAndDelete(id);
        res.json({ success: true, message: "Add-on removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAvailableAddons = async (req, res) => {
    try {
        const addons = await FoodAddon.find().sort({ createdAt: -1 });
        res.json({ success: true, count: addons.length, data: addons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAddonById = async (req, res) => {
    try {
        const { id } = req.params;
        const addon = await FoodAddon.findById(id);
        if (!addon) return res.status(404).json({ success: false, message: "Add-on not found." });
        res.json({ success: true, data: addon });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateCheckoutBill,
    placeFoodOrder,
    verifyFoodPayment,
    getMyFoodOrders,
    getSingleFoodOrder,
    createFoodAddon,
    getAvailableAddons,
    getAddonById,
    updateFoodAddon,
    deleteFoodAddon
};