// controllers/user/Ambulance/ambulanceBookingController.js

const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const Ambulance = require('../../../models/Ambulance');
const Coupon = require('../../../models/Coupon');
const CodConfig = require('../../../models/CodConfig');
const DriverNotification = require('../../../models/DriverNotification');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { calculateHaversine } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature } = require('../../../utils/razorpay');
const mongoose = require('mongoose');

// 💡 HELPER: Safe JSON Parser (Supports both JSON objects & FormData strings)
const parseField = (val) => {
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
};

// 💡 HELPER: Increment Coupon Usage for User
const recordCouponUsage = async (couponId, userId) => {
    try {
        if (!couponId || !userId) return;
        const coupon = await Coupon.findById(couponId);
        if (!coupon) return;

        if (!Array.isArray(coupon.usedBy)) coupon.usedBy = [];
        const userIndex = coupon.usedBy.findIndex(u => u.userId?.toString() === userId.toString());

        if (userIndex !== -1) {
            coupon.usedBy[userIndex].usageCount += 1;
        } else {
            coupon.usedBy.push({ userId, usageCount: 1 });
        }
        await coupon.save();
    } catch (err) {
        console.error("Error updating coupon usage:", err.message);
    }
};

// ========================================================
// 🧮 REUSABLE CALCULATION ENGINE (Base Fare + Distance + Staff + Coupon)
// ========================================================
const calculateAmbulanceBillHelper = async ({
    ambulanceId,
    rideType = 'Single Ride',
    pickupLocation,
    dropoffLocation,
    supportStaff = [],
    couponCode = null,
    userId = null
}) => {
    // 1. Verify Ambulance
    const ambulance = await Ambulance.findById(ambulanceId)
        .select('name vehicleNumber vehicleType role clinicId pricing supportStaff location')
        .populate('clinicId', 'name clinicName phoneNumber address')
        .lean();

    if (!ambulance) {
        throw new Error("Selected ambulance vehicle not found or unavailable.");
    }

    const pickup = parseField(pickupLocation);
    const dropoff = parseField(dropoffLocation);
    const selectedStaffList = parseField(supportStaff);

    // 2. Distance Calculation (KM)
    let distanceInKM = 0;
    if (pickup?.lat && pickup?.lng && dropoff?.lat && dropoff?.lng) {
        distanceInKM = calculateHaversine(
            Number(pickup.lat), Number(pickup.lng),
            Number(dropoff.lat), Number(dropoff.lng)
        );
    }

    // 3. Base Ride & Extra KM Distance Charges
    const isDoubleRide = rideType === 'Double Ride' || rideType === 'Round-Trip';
    const baseRideCharge = isDoubleRide
        ? Number(ambulance.pricing?.doubleRidePrice || 700)
        : Number(ambulance.pricing?.singleRidePrice || 400);

    const baseKM = Number(ambulance.pricing?.baseDistance || 5);
    const pricePerKM = Number(ambulance.pricing?.pricePerKM || 12);

    const extraKM = distanceInKM > baseKM ? Number((distanceInKM - baseKM).toFixed(1)) : 0;
    const distanceCharge = Math.round(extraKM * pricePerKM);

    // 4. Verify & Calculate Support Staff / On-board Facility Charges
    let verifiedSupportStaff = [];
    let staffChargesTotal = 0;

    if (Array.isArray(selectedStaffList) && selectedStaffList.length > 0) {
        const ambStaffList = Array.isArray(ambulance.supportStaff) ? ambulance.supportStaff : [];

        verifiedSupportStaff = selectedStaffList
            .filter(item => item && typeof item === 'object')
            .map(selectedItem => {
                const itemName = String(selectedItem.name || "").trim();
                const matchedStaff = ambStaffList.find(
                    s => s.name?.toLowerCase() === itemName.toLowerCase() ||
                         (selectedItem.facilityId && s.facilityId?.toString() === selectedItem.facilityId.toString())
                );

                const unitPrice = selectedItem.price !== undefined 
                    ? Number(selectedItem.price) 
                    : (matchedStaff ? Number(matchedStaff.price) : 0);

                staffChargesTotal += unitPrice;

                return {
                    facilityId: selectedItem.facilityId || matchedStaff?.facilityId || null,
                    name: itemName || matchedStaff?.name || "Staff",
                    price: unitPrice,
                    isAvailable: matchedStaff ? Boolean(matchedStaff.available) : true
                };
            });
    }

    // 5. Calculate Subtotal
    const subtotal = baseRideCharge + distanceCharge + staffChargesTotal;

    // 6. Coupon Verification & Discount
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
        const cleanCode = String(couponCode).toUpperCase().trim();
        const now = new Date();

        let couponQuery = {
            couponName: cleanCode,
            isActive: true,
            startDate: { $lte: now },
            expiryDate: { $gt: now }
        };

        // Conflict-Free Role Filtering
        if (ambulance.role === 'clinic-ambulance' && ambulance.clinicId) {
            couponQuery.$or = [
                { isAdminCreated: true, vendorType: { $in: ['Ambulance', 'Clinic', 'All'] } },
                { vendorId: ambulance.clinicId._id || ambulance.clinicId, vendorType: 'Ambulance', isAdminCreated: false }
            ];
        } else {
            couponQuery.$or = [
                { isAdminCreated: true, vendorType: { $in: ['Ambulance', 'All'] } },
                { vendorId: ambulance._id, vendorType: 'Ambulance', isAdminCreated: false }
            ];
        }

        const couponDoc = await Coupon.findOne(couponQuery);

        if (couponDoc && subtotal >= (couponDoc.minOrderAmount || 0)) {
            let isUserEligible = true;
            if (userId && Array.isArray(couponDoc.usedBy)) {
                const userUsage = couponDoc.usedBy.find(u => u.userId?.toString() === userId.toString());
                if (userUsage && userUsage.usageCount >= (couponDoc.maxUsagePerUser || 1)) {
                    isUserEligible = false;
                }
            }

            if (isUserEligible) {
                discountAmount = Math.min((subtotal * couponDoc.discountPercentage) / 100, couponDoc.maxDiscount);
                appliedCoupon = {
                    couponId: couponDoc._id,
                    couponCode: couponDoc.couponName,
                    discountPercentage: couponDoc.discountPercentage,
                    maxDiscount: couponDoc.maxDiscount,
                    discountApplied: Math.round(discountAmount)
                };
            }
        }
    }

    // 7. Final Net Payable Total
    const finalTotal = Math.max(0, Math.round(subtotal - discountAmount));

    // 8. COD Policy Check
    const codConfig = await CodConfig.findOne({ vendorType: { $in: ['Ambulance', 'All'] } });
    const isCodAvailable = codConfig ? Boolean(codConfig.isCodAvailable) : true;

    return {
        ambulanceDetails: {
            _id: ambulance._id,
            name: ambulance.name,
            vehicleNumber: ambulance.vehicleNumber,
            vehicleType: ambulance.vehicleType,
            role: ambulance.role,
            clinic: ambulance.clinicId ? {
                _id: ambulance.clinicId._id,
                name: ambulance.clinicId.clinicName || ambulance.clinicId.name,
                phoneNumber: ambulance.clinicId.phoneNumber,
                address: ambulance.clinicId.address
            } : null
        },
        routeDetails: {
            rideType: isDoubleRide ? "Double Ride" : "Single Ride",
            distanceInKM: Number(distanceInKM.toFixed(1)),
            baseDistanceIncludedKM: baseKM,
            extraKM: extraKM,
            pricePerKM: pricePerKM
        },
        supportStaffSelected: verifiedSupportStaff,
        pricingBreakdown: {
            baseRideCharge,
            distanceCharge,
            staffChargesTotal,
            subtotal,
            couponDiscount: Math.round(discountAmount),
            totalPayable: finalTotal
        },
        appliedCoupon,
        orderPolicies: {
            isCodAvailable
        }
    };
};

// ========================================================
// 🧮 1. FARE CALCULATE / CHECKOUT PREVIEW API
// Endpoint: POST /api/user/ambulance/booking/calculate-fare
// ========================================================
const calculateAmbulanceFare = async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const {
            ambulanceId,
            rideType = 'Single Ride',
            pickupLocation,
            dropoffLocation,
            supportStaff = [],
            couponCode
        } = req.body;

        if (!ambulanceId) {
            return res.status(400).json({ success: false, message: "ambulanceId is required." });
        }

        const bill = await calculateAmbulanceBillHelper({
            ambulanceId,
            rideType,
            pickupLocation,
            dropoffLocation,
            supportStaff,
            couponCode,
            userId
        });

        res.json({
            success: true,
            data: bill
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚨 2. FLOW 1: EMERGENCY AMBULANCE BOOKING (Broadcast)
// Endpoint: POST /api/user/ambulance/booking/emergency
// ==========================================
const bookEmergencyAmbulance = async (req, res) => {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        const pickupLocation = parseField(body.pickupLocation);
        const dropoffLocation = parseField(body.dropoffLocation);
        const patientDetails = parseField(body.patientDetails);
        const purpose = body.purpose || "Emergency Trauma Dispatch";
        const paymentMethod = body.paymentMethod || 'COD';

        if (!pickupLocation?.lat || !pickupLocation?.lng) {
            return res.status(400).json({ success: false, message: "Valid pickup coordinates (lat, lng) are required." });
        }

        const userLat = Number(pickupLocation.lat);
        const userLng = Number(pickupLocation.lng);

        // 1. Fetch KM Limit
        const limitConfig = await VendorKMLimit.findOne({
            vendorType: { $regex: /^ambulance$/i },
            $or: [{ isActive: true }, { isActive: { $exists: false } }]
        }).lean();
        const maxRadius = limitConfig?.kmLimit ? Number(limitConfig.kmLimit) : 50;

        // 2. Find All Online & Approved Ambulances within Radius
        const allActiveAmbulances = await Ambulance.find({
            profileStatus: 'Approved',
            isActive: true,
            isOnline: true,
            availableForEmergency: true
        }).select('_id name phone vehicleNumber location pricing clinicId role').lean();

        const nearbyAmbulances = allActiveAmbulances.filter(amb => {
            if (amb.location?.lat && amb.location?.lng) {
                const dist = calculateHaversine(userLat, userLng, Number(amb.location.lat), Number(amb.location.lng));
                return dist <= maxRadius;
            }
            return false;
        });

        if (nearbyAmbulances.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No emergency ambulances currently online nearby. Please call national helpline 108."
            });
        }

        // 3. Distance & Base Rate Calculation
        let estimatedDistance = 5;
        if (dropoffLocation?.lat && dropoffLocation?.lng) {
            estimatedDistance = calculateHaversine(userLat, userLng, Number(dropoffLocation.lat), Number(dropoffLocation.lng));
        }

        const baseRate = 400;
        const extraKmCharge = estimatedDistance > 5 ? Math.round((estimatedDistance - 5) * 12) : 0;
        const totalAmount = baseRate + extraKmCharge;

        const tempBookingId = `HK-EMG-${Date.now().toString().slice(-6)}`;
        const caseRef = `CAS-EMG-${Math.floor(1000 + Math.random() * 9000)}`;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // 4. Create Emergency Booking
        const booking = await AmbulanceBooking.create({
            bookingId: tempBookingId,
            caseReference: caseRef,
            userId,
            ambulanceId: nearbyAmbulances[0]._id, // First nearby as temporary placeholder
            clinicId: nearbyAmbulances[0].clinicId || null,
            bookingCategory: 'Emergency',
            rideType: 'Single Ride',
            pickupLocation: {
                address: pickupLocation.address || "",
                lat: userLat,
                lng: userLng
            },
            dropoffLocation: {
                address: dropoffLocation?.address || "Nearest Hospital Emergency",
                lat: dropoffLocation?.lat ? Number(dropoffLocation.lat) : 0,
                lng: dropoffLocation?.lng ? Number(dropoffLocation.lng) : 0
            },
            patientDetails: {
                name: patientDetails?.name || req.user.name || "Emergency Patient",
                age: Number(patientDetails?.age) || 30,
                gender: patientDetails?.gender || "Male",
                relation: patientDetails?.relation || "Self",
                condition: patientDetails?.condition || "Critical",
                emergencyDescription: patientDetails?.emergencyDescription || purpose
            },
            estimateTime: body.estimateTime || "Immediate (30 mins)",

            pricing: {
                baseRideCharge: baseRate,
                distanceCharge: extraKmCharge,
                subtotal: totalAmount,
                discount: 0,
                total: totalAmount
            },
            otp,
            status: 'Searching',
            paymentMethod,
            paymentStatus: 'Pending',
            trackingTimeline: [{
                status: 'Searching',
                timestamp: new Date(),
                note: `Emergency broadcast sent to ${nearbyAmbulances.length} nearby ambulances.`
            }]
        });

        // 5. Alert Nearby Drivers
        const notificationPromises = nearbyAmbulances.map(amb => {
            return DriverNotification.create({
                driverId: amb._id,
                title: "🚨 New Emergency Case Request!",
                message: `Emergency pickup at ${pickupLocation.address || "Live Location"}. Purpose: ${purpose}`,
                type: 'New Emergency Case'
            });
        });
        await Promise.allSettled(notificationPromises);

        res.status(201).json({
            success: true,
            message: `Emergency dispatch request broadcasted to ${nearbyAmbulances.length} nearby ambulances.`,
            bookingId: booking.bookingId,
            caseReference: booking.caseReference,
            totalNearbyAmbulancesAlerted: nearbyAmbulances.length,
            otp: booking.otp,
            estimatedFare: totalAmount,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚑 3. DRIVER ACCEPTS EMERGENCY RIDE
// Endpoint: POST /api/user/ambulance/booking/accept-emergency
// ==========================================
const acceptEmergencyBooking = async (req, res) => {
    try {
        const driverId = req.user.id;
        const { bookingId } = req.body;

        if (!bookingId) {
            return res.status(400).json({ success: false, message: "bookingId is required." });
        }

        const driver = await Ambulance.findById(driverId);
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }

        // 🛡️ ATOMIC LOCK: Only accept if status is still 'Searching'
        const updatedBooking = await AmbulanceBooking.findOneAndUpdate(
            { 
                $or: [
                    { bookingId: bookingId },
                    ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: bookingId }] : [])
                ],
                status: 'Searching'
            },
            {
                $set: {
                    ambulanceId: driver._id,
                    clinicId: driver.clinicId || null,
                    status: 'Confirmed'
                },
                $push: {
                    trackingTimeline: {
                        status: 'Confirmed',
                        timestamp: new Date(),
                        note: `Ride accepted by driver ${driver.name} (${driver.vehicleNumber}).`
                    }
                }
            },
            { new: true }
        )
        .populate('userId', 'name phone')
        .populate('ambulanceId', 'name vehicleNumber vehicleType phone');

        if (!updatedBooking) {
            return res.status(400).json({
                success: false,
                message: "This emergency ride has already been accepted by another driver or cancelled."
            });
        }

        res.json({
            success: true,
            message: "Emergency ride accepted successfully! Proceed to pickup location.",
            data: updatedBooking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 4. FLOW 2: REFERRAL / SCHEDULED AMBULANCE BOOKING
// Endpoint: POST /api/user/ambulance/booking/referral
// ==========================================
const bookReferralAmbulance = async (req, res) => {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        const ambulanceId = body.ambulanceId;
        const rideType = body.rideType || 'Single Ride';
        const pickupLocation = parseField(body.pickupLocation);
        const dropoffLocation = parseField(body.dropoffLocation);
        const patientDetails = parseField(body.patientDetails);
        const purpose = body.purpose || "Hospital Transfer / Referral";
        const scheduledDate = body.scheduledDate;
        const scheduledTime = body.scheduledTime;
        const estimateTime = body.estimateTime || null; // 👈 Estimated duration (e.g. "1 hr 30 mins")
        const supportStaff = parseField(body.supportStaff) || [];
        const couponCode = body.couponCode;
        const paymentMethod = body.paymentMethod || 'COD';

        if (!ambulanceId || !pickupLocation?.address || !dropoffLocation?.address) {
            return res.status(400).json({
                success: false,
                message: "ambulanceId, pickupLocation, and dropoffLocation are mandatory."
            });
        }

        // 1. Calculate Exact Bill using Unified Engine
        const bill = await calculateAmbulanceBillHelper({
            ambulanceId,
            rideType,
            pickupLocation,
            dropoffLocation,
            supportStaff,
            couponCode,
            userId
        });

        // COD Policy Check
        if (paymentMethod === 'COD' && bill.orderPolicies.isCodAvailable === false) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled for ambulance rides. Please select Online payment."
            });
        }

        const finalTotal = bill.pricingBreakdown.totalPayable;
        const tempBookingId = `HK-REF-${Date.now().toString().slice(-6)}`;
        const caseRef = `CAS-REF-${Math.floor(1000 + Math.random() * 9000)}`;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // 2. Razorpay Order Generation for Online Payment
        let rzpOrder = null;
        if (paymentMethod === 'Online' && finalTotal > 0) {
            rzpOrder = await createRazorpayOrder(finalTotal, `rec_${tempBookingId}`);
        }

        const isAutoConfirmed = paymentMethod === 'COD' || finalTotal === 0;

        // 3. Create Booking Document
        const booking = await AmbulanceBooking.create({
            bookingId: tempBookingId,
            caseReference: caseRef,
            userId,
            ambulanceId: bill.ambulanceDetails._id,
            clinicId: bill.ambulanceDetails.clinic?._id || null,
            bookingCategory: 'Referral',
            scheduledDate: scheduledDate || null,
            scheduledTime: scheduledTime || null,
            estimateTime: estimateTime, // 👈 Saved in DB
            rideType: bill.routeDetails.rideType,
            pickupLocation: {
                address: pickupLocation.address,
                lat: Number(pickupLocation.lat) || 0,
                lng: Number(pickupLocation.lng) || 0
            },
            dropoffLocation: {
                address: dropoffLocation.address,
                lat: Number(dropoffLocation.lat) || 0,
                lng: Number(dropoffLocation.lng) || 0
            },
            patientDetails: {
                name: patientDetails?.name || req.user.name || "Patient",
                age: Number(patientDetails?.age) || 30,
                gender: patientDetails?.gender || "Male",
                relation: patientDetails?.relation || "Self",
                condition: patientDetails?.condition || "Stable",
                emergencyDescription: purpose
            },
            supportStaff: bill.supportStaffSelected,
            couponDetails: bill.appliedCoupon ? {
                couponId: bill.appliedCoupon.couponId,
                couponCode: bill.appliedCoupon.couponCode,
                discountAmount: bill.appliedCoupon.discountApplied
            } : undefined,
            pricing: {
                baseRideCharge: bill.pricingBreakdown.baseRideCharge,
                distanceCharge: bill.pricingBreakdown.distanceCharge,
                subtotal: bill.pricingBreakdown.subtotal,
                discount: bill.pricingBreakdown.couponDiscount,
                total: finalTotal
            },
            otp,
            status: isAutoConfirmed ? 'Confirmed' : 'Searching',
            paymentMethod,
            paymentStatus: finalTotal === 0 ? 'Paid' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : null,
            trackingTimeline: [{
                status: isAutoConfirmed ? 'Confirmed' : 'Searching',
                timestamp: new Date(),
                note: `Referral booking for ${scheduledDate || 'Today'} (${scheduledTime || 'Immediate'}). Total fare: ₹${finalTotal}.`
            }]
        });

        // 4. Increment Coupon Usage if Auto-Confirmed
        if (isAutoConfirmed && bill.appliedCoupon?.couponId) {
            await recordCouponUsage(bill.appliedCoupon.couponId, userId);
        }

        // 5. Notify Driver
        await DriverNotification.create({
            driverId: bill.ambulanceDetails._id,
            title: "📋 New Referral Booking",
            message: `Scheduled ride for ${scheduledDate || 'Today'} (${scheduledTime || 'Immediate'}). Purpose: ${purpose}`,
            type: 'Referral Received'
        });

        // Response for Online Payment
        if (paymentMethod === 'Online' && rzpOrder) {
            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: "Razorpay payment order generated.",
                key_id: process.env.RAZORPAY_KEY_ID,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                bookingId: booking.bookingId,
                caseReference: booking.caseReference,
                otp: booking.otp,
                billSummary: bill.pricingBreakdown,
                data: booking
            });
        }

        // Response for COD / ₹0 Free
        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "Referral ambulance ride booked successfully (COD).",
            bookingId: booking.bookingId,
            caseReference: booking.caseReference,
            otp: booking.otp,
            billSummary: bill.pricingBreakdown,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💳 5. VERIFY RAZORPAY PAYMENT
// Endpoint: POST /api/user/ambulance/booking/verify-payment
// ==========================================
const verifyAmbulancePayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            bookingId,
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature
        } = req.body;

        if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                success: false,
                message: "bookingId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required."
            });
        }

        // 1. Verify Cryptographic Signature
        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({
                success: false,
                message: "Payment signature verification failed. Invalid transaction."
            });
        }

        // 2. Find and Update Booking Record
        const booking = await AmbulanceBooking.findOne({
            $or: [
                { bookingId: bookingId },
                ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: bookingId }] : [])
            ],
            userId
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Ambulance booking record not found."
            });
        }

        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.transactionId = razorpayPaymentId;
        booking.status = 'Confirmed';

        booking.trackingTimeline.push({
            status: 'Confirmed',
            timestamp: new Date(),
            note: `Online payment of ₹${booking.pricing?.total || 0} verified successfully (Txn: ${razorpayPaymentId}). Ride confirmed!`
        });

        await booking.save();

        // 3. Increment Coupon Usage Count
        if (booking.couponDetails?.couponId) {
            await recordCouponUsage(booking.couponDetails.couponId, userId);
        }

        // 4. Notify Driver
        if (booking.ambulanceId) {
            await DriverNotification.create({
                driverId: booking.ambulanceId,
                title: "💳 Payment Verified & Ride Confirmed",
                message: `Patient ${booking.patientDetails?.name || 'User'} has paid ₹${booking.pricing?.total || 0} online. Ride is confirmed.`,
                type: 'Referral Received'
            });
        }

        res.json({
            success: true,
            message: "Ambulance payment verified successfully! Ride is now confirmed.",
            bookingId: booking.bookingId,
            caseReference: booking.caseReference,
            paymentStatus: booking.paymentStatus,
            status: booking.status,
            otp: booking.otp,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 📋 6. GET ALL USER BOOKING ORDERS (Lightweight Summary List)
// Endpoint: GET /api/user/ambulance/booking/my-orders
// ==========================================
const getUserAmbulanceBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, bookingCategory } = req.query;

        let query = { userId };
        if (status) query.status = status;
        if (bookingCategory) query.bookingCategory = bookingCategory;

        const bookings = await AmbulanceBooking.find(query)
            .select('bookingId caseReference bookingCategory rideType status paymentStatus paymentMethod pricing.total scheduledDate scheduledTime estimateTime pickupLocation.address dropoffLocation.address ambulanceId clinicId createdAt')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
            .populate('clinicId', 'name clinicName phoneNumber')
            .sort({ createdAt: -1 })
            .lean();

        // 🎯 Lightweight Summary Mapping (Only Essential Fields)
        const summaryList = bookings.map(b => ({
            _id: b._id,
            bookingId: b.bookingId,
            caseReference: b.caseReference,
            bookingCategory: b.bookingCategory || 'Emergency',
            rideType: b.rideType || 'Single Ride',
            status: b.status,
            paymentStatus: b.paymentStatus,
            paymentMethod: b.paymentMethod,
            totalAmount: b.pricing?.total || 0,
            scheduledDate: b.scheduledDate || null,
            scheduledTime: b.scheduledTime || null,
            estimateTime: b.estimateTime || null,
            pickupAddress: b.pickupLocation?.address || "",
            dropoffAddress: b.dropoffLocation?.address || "",
            ambulance: b.ambulanceId ? {
                _id: b.ambulanceId._id,
                name: b.ambulanceId.name,
                vehicleNumber: b.ambulanceId.vehicleNumber,
                vehicleType: b.ambulanceId.vehicleType,
                phone: b.ambulanceId.phone
            } : null,
            clinic: b.clinicId ? {
                _id: b.clinicId._id,
                name: b.clinicId.clinicName || b.clinicId.name,
                phone: b.clinicId.phoneNumber
            } : null,
            createdAt: b.createdAt
        }));

        res.json({
            success: true,
            count: summaryList.length,
            data: summaryList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 7. GET SINGLE BOOKING ORDER FULL DETAILS BY ID
// Endpoint: GET /api/user/ambulance/booking/order/:id
// ==========================================
const getUserAmbulanceBookingById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Find by MongoDB _id, bookingId, or caseReference
        const booking = await AmbulanceBooking.findOne({
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { bookingId: id },
                { caseReference: id }
            ],
            userId
        })
        .populate('ambulanceId', 'name vehicleNumber vehicleType phone bloodGroup experienceYears location pricing')
        .populate('clinicId', 'name clinicName phoneNumber address image')
        .populate('userId', 'name phone email')
        .lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Ambulance booking order not found."
            });
        }

        res.json({
            success: true,
            data: booking // 👈 Returns 100% full detailed object
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    calculateAmbulanceFare,
    bookEmergencyAmbulance,
    acceptEmergencyBooking,
    bookReferralAmbulance,
    verifyAmbulancePayment,
    getUserAmbulanceBookings,
    getUserAmbulanceBookingById
};