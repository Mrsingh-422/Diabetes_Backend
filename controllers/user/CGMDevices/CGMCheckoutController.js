// controllers/user/CGMDevices/CGMCheckoutController.js

const CGMOrder = require('../../../models/CGMOrder');
const CGMDevices = require('../../../models/CGMDevicesModel');
const CGMAddon = require('../../../models/CGMAddon');
const CodConfig = require('../../../models/CodConfig');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const CoachDistanceConfig = require('../../../models/CoachDistanceConfig');
const { isCoachSlotAvailable } = require('../../../utils/timeSlotHelper');
const { calculateHaversine } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature ,refundRazorpayPayment} = require('../../../utils/razorpay');
const mongoose = require('mongoose');

// =========================================================================
// 🧮 REUSABLE BILLING ENGINE (Device + Addons + Online/Offline Coach Fee + KM Surcharge)
// =========================================================================
//  REUSABLE BILLING ENGINE (With Real-Time Stock Validation)
const calculateCGMBillHelper = async ({
    deviceId,
    variantId = null,
    quantity = 1,
    addons = [],
    coachId = null,
    consultationMode = 'Online',
    userLat = null,
    userLng = null,
    scheduledDate = null,
    slotTime = null
}) => {
    // 1. Fetch & Verify Device
    const device = await CGMDevices.findOne({ _id: deviceId, isActive: true }).lean();
    if (!device) {
        throw new Error("Selected product not found or is currently unavailable.");
    }

    const orderQty = Math.max(1, parseInt(quantity, 10) || 1);
    let selectedVariant = null;
    let unitPrice = Number(device.sellingPrice) || 0;
    let unitMrp = Number(device.mrp) || 0;
    let currentAvailableStock = Number(device.stockQuantity) || 0;

    // Check Variants (Glucometer Strips OR CGM Multi-Packs)
    if (variantId && mongoose.Types.ObjectId.isValid(variantId)) {
        if (device.productType === 'Glucometer' && Array.isArray(device.glucometerConfig?.stripLancetVariants)) {
            const matched = device.glucometerConfig.stripLancetVariants.find(v => v._id?.toString() === variantId.toString());
            if (matched) {
                selectedVariant = matched;
                unitPrice = Number(matched.sellingPrice);
                unitMrp = Number(matched.mrp);
                currentAvailableStock = Number(matched.stockQuantity) || 0;
            }
        } else if (device.productType === 'CGM' && Array.isArray(device.cgmConfig?.cgmPacks)) {
            const matched = device.cgmConfig.cgmPacks.find(p => p._id?.toString() === variantId.toString());
            if (matched) {
                selectedVariant = matched;
                unitPrice = Number(matched.sellingPrice);
                unitMrp = Number(matched.mrp);
                currentAvailableStock = Number(matched.stockQuantity) || 0;
            }
        }
    }

    // 🛑 OUT OF STOCK CHECK
    if (currentAvailableStock <= 0) {
        throw new Error(`Out of Stock: '${selectedVariant ? (selectedVariant.variantName || selectedVariant.packName) : device.title}' is currently sold out.`);
    }

    if (currentAvailableStock < orderQty) {
        throw new Error(`Insufficient Stock: Only ${currentAvailableStock} unit(s) available.`);
    }

    const itemTotal = unitPrice * orderQty;
    const mrpTotal = unitMrp * orderQty;
    const deviceSavings = mrpTotal > itemTotal ? mrpTotal - itemTotal : 0;

    // 2. Addons Calculation
    let verifiedAddons = [];
    let addonsTotal = 0;

    if (Array.isArray(addons) && addons.length > 0) {
        for (const addonItem of addons) {
            if (!addonItem.addonId || !mongoose.Types.ObjectId.isValid(addonItem.addonId)) continue;

            const addonDoc = await CGMAddon.findOne({ _id: addonItem.addonId, isActive: true }).lean();
            if (addonDoc && addonDoc.price > 0) {
                const addonQty = Math.max(1, parseInt(addonItem.quantity, 10) || 1);
                const addonItemPrice = Number(addonDoc.price) * addonQty;
                addonsTotal += addonItemPrice;

                verifiedAddons.push({
                    addonId: addonDoc._id,
                    name: addonDoc.name,
                    price: Number(addonDoc.price),
                    quantity: addonQty,
                    totalPrice: addonItemPrice
                });
            }
        }
    }

    // 3. 👨‍⚕️ Coach Calculation with Distance Surcharge & Premium Slot
    let coachInfo = {
        isIncluded: false,
        coachId: null,
        coachName: "",
        coachType: "Both",
        consultationMode: consultationMode || 'Online',
        scheduledDate: scheduledDate || null,
        slotTime: slotTime || null,
        basePrice: 0,
        distanceInKM: 0,
        freeDistanceIncludedKM: 5,
        extraDistanceCharge: 0,
        isPremiumSlot: false,
        premiumExtraFee: 0,
        charge: 0
    };

    if (coachId && mongoose.Types.ObjectId.isValid(coachId)) {
        const coachDoc = await DiabetesCoach.findOne({ _id: coachId, isActive: true }).lean();
        if (coachDoc) {
            const isOffline = consultationMode === 'Offline';
            let basePrice = isOffline
                ? (coachDoc.fees?.offline !== undefined ? Number(coachDoc.fees.offline) : 599)
                : (coachDoc.fees?.online !== undefined ? Number(coachDoc.fees.online) : (Number(coachDoc.price) || 299));

            let distanceInKM = 0;
            let extraDistanceCharge = 0;
            let freeKM = 5;

            if (isOffline) {
                try {
                    const distanceConfig = await CoachDistanceConfig.findOne({ isActive: true }).lean();
                    freeKM = distanceConfig?.freeDistanceKM !== undefined ? Number(distanceConfig.freeDistanceKM) : 5;
                    const pricePerKM = distanceConfig?.pricePerKM !== undefined ? Number(distanceConfig.pricePerKM) : 15;

                    if (userLat && userLng && coachDoc.location?.lat && coachDoc.location?.lng) {
                        distanceInKM = calculateHaversine(
                            Number(userLat), Number(userLng),
                            Number(coachDoc.location.lat), Number(coachDoc.location.lng)
                        );

                        if (distanceInKM > freeKM) {
                            const extraKM = Number((distanceInKM - freeKM).toFixed(1));
                            extraDistanceCharge = Math.round(extraKM * pricePerKM);
                        }
                    }
                } catch (distErr) {
                    extraDistanceCharge = 0;
                }
            }

            let isPremium = false;
            let extraSlotFee = 0;

            if (slotTime && Array.isArray(coachDoc.slotConfig?.premiumSlots)) {
                const matchedPremium = coachDoc.slotConfig.premiumSlots.find(p =>
                    p.time === slotTime || (typeof slotTime === 'string' && slotTime.startsWith(p.time))
                );

                if (matchedPremium && Number(matchedPremium.extraFee) > 0) {
                    isPremium = true;
                    extraSlotFee = Number(matchedPremium.extraFee);
                }
            }

            const totalCoachCharge = basePrice + extraDistanceCharge + extraSlotFee;

            coachInfo = {
                isIncluded: true,
                coachId: coachDoc._id,
                coachName: coachDoc.name,
                coachType: coachDoc.coachType || "Both",
                consultationMode: isOffline ? 'Offline' : 'Online',
                scheduledDate: scheduledDate || null,
                slotTime: slotTime || null,
                basePrice: basePrice,
                distanceInKM: Number(distanceInKM.toFixed(1)),
                freeDistanceIncludedKM: freeKM,
                extraDistanceCharge: extraDistanceCharge,
                isPremiumSlot: isPremium,
                premiumExtraFee: extraSlotFee,
                charge: totalCoachCharge
            };
        }
    }

    // 4. Net Subtotal & Payable
    const subtotal = itemTotal + addonsTotal + coachInfo.charge;
    const totalPayable = subtotal;

    // 5. COD Policy Check
    const codConfig = await CodConfig.findOne({ vendorType: { $in: ['Pharmacy', 'All'] } });
    const isCodAvailable = codConfig ? Boolean(codConfig.isCodAvailable) : true;

    return {
        deviceSummary: {
            _id: device._id,
            title: device.title,
            brand: device.brand,
            productType: device.productType,
            deviceModel: device.deviceModel,
            mainImage: device.mainImage,
            unitPrice,
            unitMrp,
            quantity: orderQty,
            availableStock: currentAvailableStock,
            selectedVariant: selectedVariant ? {
                variantId: selectedVariant._id,
                variantName: selectedVariant.variantName || selectedVariant.packName,
                mrp: selectedVariant.mrp,
                sellingPrice: selectedVariant.sellingPrice,
                savingsBadge: selectedVariant.savingsBadge || ""
            } : null
        },
        addonsSelected: verifiedAddons,
        coachConsultation: coachInfo,
        pricingBreakdown: {
            itemTotal,
            mrpTotal,
            deviceSavings,
            addonsTotal,
            coachConsultationMode: coachInfo.consultationMode,
            coachBaseFee: coachInfo.basePrice,
            coachFreeDistanceKM: coachInfo.freeDistanceIncludedKM,
            coachExtraDistanceCharge: coachInfo.extraDistanceCharge,
            coachPremiumExtraFee: coachInfo.premiumExtraFee,
            coachChargeTotal: coachInfo.charge,
            subtotal,
            couponDiscount: 0,
            totalPayable
        },
        appliedCoupon: null,
        orderPolicies: {
            isCodAvailable
        }
    };
};


// =========================================================================
// 🧮 1. CHECKOUT PREVIEW API (FIXED: Passed consultationMode, userLat, userLng)
// Endpoint: POST /api/user/cgm/checkout/calculate-bill
// =========================================================================
const calculateCGMBill = async (req, res) => {
    try {
        const {
            deviceId,
            variantId,
            quantity = 1,
            addons = [],
            coachId = null,
            consultationMode = 'Online', // 👈 FIX 2: Extracted & passed
            userLat = null,              // 👈 FIX 2: Extracted & passed
            userLng = null,              // 👈 FIX 2: Extracted & passed
            scheduledDate = null,
            slotTime = null
        } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: "deviceId is required." });
        }

        const bill = await calculateCGMBillHelper({
            deviceId,
            variantId,
            quantity,
            addons,
            coachId,
            consultationMode,
            userLat,
            userLng,
            scheduledDate,
            slotTime
        });

        res.json({
            success: true,
            data: bill
        });

    } catch (error) {
        console.error("calculateCGMBill Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🛍️ 2. CHECKOUT & PLACE ORDER (With Automatic Stock Deduction)
// Endpoint: POST /api/user/cgm/checkout/place-order
// =========================================================================
const placeCGMOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            deviceId,
            variantId,
            quantity = 1,
            addons = [],
            coachId = null,
            consultationMode = 'Online',
            userLat = null,
            userLng = null,
            scheduledDate = null,
            slotTime = null,
            deliveryAddress,
            diabetesProfile,
            paymentMethod = 'COD'
        } = req.body;

        if (!deviceId || !deliveryAddress || !deliveryAddress.name || !deliveryAddress.phone || !deliveryAddress.city || !deliveryAddress.pincode) {
            return res.status(400).json({
                success: false,
                message: "deviceId and complete deliveryAddress (name, phone, city, pincode) are required."
            });
        }

        const orderQty = Math.max(1, parseInt(quantity, 10) || 1);

        // 1. Fetch Device document to deduct real stock
        const targetDevice = await CGMDevices.findById(deviceId);
        if (!targetDevice || !targetDevice.isActive) {
            return res.status(404).json({ success: false, message: "Product is currently unavailable." });
        }

        // 2. Validate and Deduct Stock in memory
        if (variantId && mongoose.Types.ObjectId.isValid(variantId)) {
            if (targetDevice.productType === 'Glucometer' && Array.isArray(targetDevice.glucometerConfig?.stripLancetVariants)) {
                const variantDoc = targetDevice.glucometerConfig.stripLancetVariants.id(variantId);
                if (!variantDoc || (variantDoc.stockQuantity || 0) < orderQty) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Insufficient stock for ${variantDoc?.variantName || 'selected variant'}. Only ${variantDoc?.stockQuantity || 0} unit(s) left.` 
                    });
                }
                variantDoc.stockQuantity -= orderQty;
            } else if (targetDevice.productType === 'CGM' && Array.isArray(targetDevice.cgmConfig?.cgmPacks)) {
                const packDoc = targetDevice.cgmConfig.cgmPacks.id(variantId);
                if (!packDoc || (packDoc.stockQuantity || 0) < orderQty) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Insufficient stock for ${packDoc?.packName || 'selected pack'}. Only ${packDoc?.stockQuantity || 0} unit(s) left.` 
                    });
                }
                packDoc.stockQuantity -= orderQty;
            }
        } else {
            // Standalone Device
            if ((targetDevice.stockQuantity || 0) < orderQty) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Insufficient stock for ${targetDevice.title}. Only ${targetDevice.stockQuantity || 0} unit(s) left.` 
                });
            }
        }

        // Parent device overall stock reduction
        targetDevice.stockQuantity = Math.max(0, (targetDevice.stockQuantity || 0) - orderQty);
        if (targetDevice.stockQuantity === 0) {
            targetDevice.isAvailable = false; // Auto mark unavailable if sold out
        }

        // Slot Collision Check
        if (coachId && scheduledDate && slotTime) {
            const isAvailable = await isCoachSlotAvailable(coachId, scheduledDate, slotTime, CGMOrder);
            if (!isAvailable) {
                return res.status(400).json({
                    success: false,
                    message: "The selected coach slot is already booked. Please choose another time slot."
                });
            }
        }

        const finalLat = userLat !== null ? userLat : (deliveryAddress.lat || null);
        const finalLng = userLng !== null ? userLng : (deliveryAddress.lng || null);

        // Calculate Bill
        const bill = await calculateCGMBillHelper({
            deviceId,
            variantId,
            quantity: orderQty,
            addons,
            coachId,
            consultationMode,
            userLat: finalLat,
            userLng: finalLng,
            scheduledDate,
            slotTime
        });

        if (paymentMethod === 'COD' && bill.orderPolicies.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled. Please choose Online payment."
            });
        }

        const finalTotal = bill.pricingBreakdown.totalPayable;
        const orderId = `DW-CGM-${Date.now().toString().slice(-6)}`;
        const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();

        let rzpOrder = null;
        if (paymentMethod === 'Online' && finalTotal > 0) {
            rzpOrder = await createRazorpayOrder(finalTotal, `cgm_${orderId}`);
        }

        const isAutoConfirmed = paymentMethod === 'COD' || finalTotal === 0;

        // 3. Create Order Document
        const newOrder = await CGMOrder.create({
            orderId,
            userId,
            device: {
                deviceId: bill.deviceSummary._id,
                productType: bill.deviceSummary.productType,
                title: bill.deviceSummary.title,
                brand: bill.deviceSummary.brand,
                mainImage: bill.deviceSummary.mainImage,
                deviceModel: bill.deviceSummary.deviceModel,
                selectedVariant: bill.deviceSummary.selectedVariant,
                unitPrice: bill.deviceSummary.unitPrice,
                unitMrp: bill.deviceSummary.unitMrp,
                quantity: bill.deviceSummary.quantity
            },
            diabetesProfile: {
                diabetesType: diabetesProfile?.diabetesType || 'Type 2',
                hasUsedBefore: Boolean(diabetesProfile?.hasUsedBefore)
            },
            deliveryAddress: {
                name: deliveryAddress.name,
                phone: deliveryAddress.phone,
                houseNo: deliveryAddress.houseNo || "",
                sector: deliveryAddress.sector || "",
                landmark: deliveryAddress.landmark || "",
                city: deliveryAddress.city,
                state: deliveryAddress.state || "",
                pincode: deliveryAddress.pincode,
                addressType: deliveryAddress.addressType || "Home"
            },
            addons: bill.addonsSelected,
            coachConsultation: bill.coachConsultation,
            billSummary: bill.pricingBreakdown,
            appliedCoupon: null,
            paymentMethod,
            paymentStatus: finalTotal === 0 ? 'Paid' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : null,
            status: isAutoConfirmed ? 'Confirmed' : 'Placed',
            deliveryOtp,
            trackingTimeline: [{
                status: isAutoConfirmed ? 'Confirmed' : 'Placed',
                timestamp: new Date(),
                note: `Order placed successfully (${paymentMethod}). Total: ₹${finalTotal}.`
            }]
        });

        // 🔻 4. SAVE REDUCED STOCK IN DATABASE PERMANENTLY
        await targetDevice.save();

        if (paymentMethod === 'Online' && rzpOrder) {
            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: "Razorpay payment initiated.",
                key_id: process.env.RAZORPAY_KEY_ID,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                orderId: newOrder.orderId,
                billSummary: bill.pricingBreakdown,
                data: newOrder
            });
        }

        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "Order placed successfully (Cash on Delivery). Stock updated.",
            orderId: newOrder.orderId,
            deliveryOtp: newOrder.deliveryOtp,
            billSummary: bill.pricingBreakdown,
            data: newOrder
        });

    } catch (error) {
        console.error("placeCGMOrder Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 💳 3. VERIFY RAZORPAY PAYMENT API
// =========================================================================
const verifyCGMPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                success: false,
                message: "orderId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required."
            });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment verification failed. Invalid signature." });
        }

        const order = await CGMOrder.findOne({
            $or: [
                { orderId: orderId },
                ...(mongoose.Types.ObjectId.isValid(orderId) ? [{ _id: orderId }] : [])
            ],
            userId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        order.paymentStatus = 'Paid';
        order.paymentMethod = 'Online';
        order.transactionId = razorpayPaymentId;
        order.status = 'Confirmed';

        order.trackingTimeline.push({
            status: 'Confirmed',
            timestamp: new Date(),
            note: `Online payment of ₹${order.billSummary?.totalPayable || 0} verified successfully (Txn: ${razorpayPaymentId}). Order confirmed!`
        });

        await order.save();

        res.json({
            success: true,
            message: "Payment verified successfully! Order is confirmed.",
            orderId: order.orderId,
            paymentStatus: order.paymentStatus,
            status: order.status,
            deliveryOtp: order.deliveryOtp,
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📋 4. GET MY ORDERS (WITH PAGINATION & COACH/ADDON SUMMARY)
// Endpoint: GET /api/user/cgm/checkout/my-orders
// =========================================================================
const getMyCGMOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, page = 1, limit = 10 } = req.query;

        const query = { userId };
        if (status && status.trim() !== '') {
            query.status = status.trim();
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await CGMOrder.countDocuments(query);

        // Lightweight card projection + Coach/Addons summary
        const orders = await CGMOrder.find(query)
            .select('_id orderId device.title device.productType device.mainImage device.selectedVariant device.unitPrice device.quantity deliveryAddress.city billSummary.totalPayable paymentMethod paymentStatus status coachConsultation.isIncluded coachConsultation.coachName coachConsultation.consultationMode addons createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Clean Format for User Order Cards
        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            device: {
                title: order.device?.title || "Device",
                productType: order.device?.productType || "Glucometer",
                mainImage: order.device?.mainImage || null,
                selectedVariant: order.device?.selectedVariant?.variantName || "Standard",
                unitPrice: order.device?.unitPrice || 0,
                quantity: order.device?.quantity || 1
            },
            coachSummary: {
                isIncluded: Boolean(order.coachConsultation?.isIncluded),
                coachName: order.coachConsultation?.coachName || null,
                consultationMode: order.coachConsultation?.consultationMode || "Online"
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
// 🔍 5. GET SINGLE ORDER FULL DETAILS BY ID
// Endpoint: GET /api/user/cgm/checkout/order/:id
// =========================================================================
const getCGMOrderById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const query = {
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { orderId: id }
            ],
            userId
        };

        const order = await CGMOrder.findOne(query)
            .populate('device.deviceId', 'title brand mainImage deviceModel glucometerConfig cgmConfig userManualPdf')
            .populate('addons.addonId', 'name price description imageUrl')
            .populate('coachConsultation.coachId', 'name price qualification coachType profileImage phone email')
            .populate('userId', 'name phone email')
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        res.json({
            success: true,
            data: order //  100% complete details for full order tracking view
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// =========================================================================
// 🧩 6. GET ACTIVE ADDONS
// =========================================================================
const getUserCGMAddons = async (req, res) => {
    try {
        const addons = await CGMAddon.find({ isActive: true, coachCharge: 0 })
            .select('_id name price description imageUrl')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            count: addons.length,
            data: addons
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🚫 6. CANCEL CGM ORDER BY USER (INITIATES 100% REFUND REQUEST FOR ADMIN)
// Endpoint: PATCH /user/cgm/devices/order/cancel/:id
// =========================================================================
const cancelUserCGMOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { cancelReason } = req.body;

        const order = await CGMOrder.findOne({
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { orderId: id }
            ],
            userId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        if (order.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This order is already cancelled." });
        }

        if (order.status === 'Delivered') {
            return res.status(400).json({ success: false, message: "Delivered orders cannot be cancelled." });
        }

        if (order.status === 'Out For Delivery') {
            return res.status(400).json({
                success: false,
                message: "Order is already out for delivery and cannot be cancelled now. Please refuse delivery at doorstep."
            });
        }

        // 🔄 RESTORE STOCK IN DATABASE
        if (order.device?.deviceId) {
            const deviceDoc = await CGMDevices.findById(order.device.deviceId);
            if (deviceDoc) {
                const restoreQty = Number(order.device.quantity) || 1;
                const vId = order.device.selectedVariant?.variantId;

                if (vId && mongoose.Types.ObjectId.isValid(vId)) {
                    if (deviceDoc.productType === 'Glucometer' && Array.isArray(deviceDoc.glucometerConfig?.stripLancetVariants)) {
                        const vDoc = deviceDoc.glucometerConfig.stripLancetVariants.id(vId);
                        if (vDoc) vDoc.stockQuantity = (vDoc.stockQuantity || 0) + restoreQty;
                    } else if (deviceDoc.productType === 'CGM' && Array.isArray(deviceDoc.cgmConfig?.cgmPacks)) {
                        const pDoc = deviceDoc.cgmConfig.cgmPacks.id(vId);
                        if (pDoc) pDoc.stockQuantity = (pDoc.stockQuantity || 0) + restoreQty;
                    }
                }

                deviceDoc.stockQuantity = (deviceDoc.stockQuantity || 0) + restoreQty;
                deviceDoc.isAvailable = true;
                await deviceDoc.save();
            }
        }

        const reasonText = cancelReason && cancelReason.trim() !== '' 
            ? cancelReason.trim() 
            : "Cancelled by user before dispatch.";

        // 💰 100% Refund Setup for Online Paid Orders
        const isOnlinePaid = order.paymentMethod === 'Online' && order.paymentStatus === 'Paid';
        const totalAmount = order.billSummary?.totalPayable || 0;

        order.status = 'Cancelled';
        order.paymentStatus = isOnlinePaid ? 'Refund-Pending' : order.paymentStatus;
        
        order.refundDetails = {
            isRefundApplicable: isOnlinePaid,
            refundAmount: isOnlinePaid ? totalAmount : 0, // 👈 100% Refund Amount
            totalPaidAmount: isOnlinePaid ? totalAmount : 0,
            penaltyCharge: 0, // User cancel par zero penalty
            cancelledBy: 'User',
            refundStatus: isOnlinePaid ? 'Pending' : 'Not Applicable',
            refundNote: `100% refund requested due to user cancellation. Reason: ${reasonText}`
        };

        order.trackingTimeline.push({
            status: 'Cancelled',
            timestamp: new Date(),
            note: `Order cancelled by user. ${isOnlinePaid ? '100% refund initiated for Admin processing.' : ''} Reason: ${reasonText}`
        });

        await order.save();

        res.json({
            success: true,
            message: isOnlinePaid 
                ? "Order cancelled successfully! 100% refund has been submitted to Admin for processing." 
                : "Order cancelled successfully!",
            orderId: order.orderId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            refundInfo: order.refundDetails,
            data: order
        });

    } catch (error) {
        console.error("cancelUserCGMOrder error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    calculateCGMBill,
    placeCGMOrder,
    verifyCGMPayment,
    getMyCGMOrders,
    getCGMOrderById,
    getUserCGMAddons,
    cancelUserCGMOrder
};