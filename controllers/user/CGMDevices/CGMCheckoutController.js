// controllers/user/CGMDevices/CGMCheckoutController.js

const CGMOrder = require('../../../models/CGMOrder');
const CGMDevices = require('../../../models/CGMDevicesModel');
const CGMAddon = require('../../../models/CGMAddon');
const CodConfig = require('../../../models/CodConfig');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const { isCoachSlotAvailable } = require('../../../utils/timeSlotHelper');
const CoachDistanceConfig = require('../../../models/CoachDistanceConfig');
const { createRazorpayOrder, verifyRazorpaySignature } = require('../../../utils/razorpay');
const mongoose = require('mongoose');

// =========================================================================
// 🧮 REUSABLE BILLING ENGINE (With Admin Managed Free KM & Auto Distance Surcharge)
// =========================================================================
const calculateCGMBillHelper = async ({
    deviceId,
    variantId = null,
    quantity = 1,
    addons = [],
    coachId = null,
    consultationMode = 'Online', // 'Online' OR 'Offline'
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

    // Check Variants
    if (variantId && mongoose.Types.ObjectId.isValid(variantId)) {
        if (device.productType === 'Glucometer' && Array.isArray(device.glucometerConfig?.stripLancetVariants)) {
            const matched = device.glucometerConfig.stripLancetVariants.find(v => v._id?.toString() === variantId.toString());
            if (matched) {
                selectedVariant = matched;
                unitPrice = Number(matched.sellingPrice);
                unitMrp = Number(matched.mrp);
            }
        } else if (device.productType === 'CGM' && Array.isArray(device.cgmConfig?.cgmPacks)) {
            const matched = device.cgmConfig.cgmPacks.find(p => p._id?.toString() === variantId.toString());
            if (matched) {
                selectedVariant = matched;
                unitPrice = Number(matched.sellingPrice);
                unitMrp = Number(matched.mrp);
            }
        }
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

    // 3. 👨‍⚕️ Coach Calculation with Admin Managed Distance Surcharge
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
                ? (Number(coachDoc.fees?.offline) || 599) 
                : (Number(coachDoc.fees?.online) || Number(coachDoc.price) || 299);

            let distanceInKM = 0;
            let extraDistanceCharge = 0;
            let freeKM = 5;

            // 🚗 Admin Global Distance Config Fetch
            if (isOffline) {
                const distanceConfig = await CoachDistanceConfig.findOne({ isActive: true }).lean();
                freeKM = distanceConfig?.freeDistanceKM !== undefined ? Number(distanceConfig.freeDistanceKM) : 5;
                const pricePerKM = distanceConfig?.pricePerKM !== undefined ? Number(distanceConfig.pricePerKM) : 15;

                if (userLat && userLng && coachDoc.location?.lat && coachDoc.location?.lng) {
                    distanceInKM = calculateHaversine(
                        Number(userLat), Number(userLng),
                        Number(coachDoc.location.lat), Number(coachDoc.location.lng)
                    );

                    // Agar user distance free distance se zyada hai, tabhi charge lagega
                    if (distanceInKM > freeKM) {
                        const extraKM = Number((distanceInKM - freeKM).toFixed(1));
                        extraDistanceCharge = Math.round(extraKM * pricePerKM);
                    }
                }
            }

            // 💎 Premium Slot Check
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

            // Total Coach Charge = Base Fee + Auto Extra KM Surcharge + Premium Slot Fee
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
// 🧮 1. CHECKOUT PREVIEW API
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
            scheduledDate,
            slotTime
        });

        res.json({
            success: true,
            data: bill
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🛍️ 2. CHECKOUT & PLACE ORDER API (COD / RAZORPAY ONLINE)
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
            consultationMode = 'Online', // 'Online' OR 'Offline'
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

        // 1. Recalculate Bill securely on Backend (With Online/Offline fee & KM surcharge)
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

        // COD Policy check
        if (paymentMethod === 'COD' && bill.orderPolicies.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled. Please choose Online payment."
            });
        }

        const finalTotal = bill.pricingBreakdown.totalPayable;
        const orderId = `HK-CGM-${Date.now().toString().slice(-6)}`;
        const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // 2. Razorpay Order Creation
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
            coachConsultation: bill.coachConsultation, // 👈 Stores Online/Offline mode, extra KM fee, and slot
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

        // Response for Online Payment
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

        // Response for COD
        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "Order placed successfully (Cash on Delivery).",
            orderId: newOrder.orderId,
            deliveryOtp: newOrder.deliveryOtp,
            billSummary: bill.pricingBreakdown,
            data: newOrder
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 💳 3. VERIFY RAZORPAY PAYMENT API
// Endpoint: POST /api/user/cgm/checkout/verify-payment
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
// 📋 4. GET MY ORDERS (LIGHTWEIGHT SUMMARY LIST)
// Endpoint: GET /api/user/cgm/checkout/my-orders
// =========================================================================
const getMyCGMOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status } = req.query;

        const query = { userId };
        if (status) query.status = status;

        const orders = await CGMOrder.find(query)
            .select('orderId device.title device.productType device.mainImage device.selectedVariant device.unitPrice device.quantity billSummary.totalPayable paymentMethod paymentStatus status deliveryAddress.city createdAt')
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

// =========================================================================
// 🔍 5. GET SINGLE ORDER DETAILS BY ID (FULL DETAIL VIEW)
// Endpoint: GET /api/user/cgm/checkout/order/:id
// =========================================================================
const getCGMOrderById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const order = await CGMOrder.findOne({
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { orderId: id }
            ],
            userId
        })
        .populate('device.deviceId', 'title brand mainImage deviceModel glucometerConfig cgmConfig userManualPdf')
        .populate('addons.addonId', 'name price imageUrl')
        .populate('coachConsultation.coachChargeId', 'name coachCharge description')
        .populate('userId', 'name phone email')
        .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🧩 4. GET ACTIVE CGM ADDONS FOR USER CHECKOUT SCREEN
// Endpoint: GET /user/cgm/devices/addons
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

module.exports = {
    calculateCGMBill,
    placeCGMOrder,
    verifyCGMPayment,
    getMyCGMOrders,
    getCGMOrderById,
    getUserCGMAddons
};