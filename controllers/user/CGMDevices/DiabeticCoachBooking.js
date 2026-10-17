// controllers/user/CGMDevices/DiabeticCoachBookingController.js

const DiabeticCoachBooking = require('../../../models/DiabeticCoachBooking');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const CoachDistanceConfig = require('../../../models/CoachDistanceConfig');
const User = require('../../../models/User');
const { calculateHaversine } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature, refundRazorpayPayment } = require('../../../utils/razorpay');
const mongoose = require('mongoose');

// =========================================================================
// 🧮 HELPER: CALCULATE COACH FARE (Online/Offline + Distance + Premium Slot)
// =========================================================================
const calculateCoachFareHelper = async ({
    coachId,
    consultationMode = 'Online',
    scheduledDate,
    slotTime,
    userLat = null,
    userLng = null
}) => {
    const coach = await DiabetesCoach.findOne({ _id: coachId, isActive: true }).lean();
    if (!coach) {
        throw new Error("Selected Diabetes Coach is not available or inactive.");
    }

    const isOffline = consultationMode === 'Offline';
    let basePrice = isOffline
        ? (coach.fees?.offline !== undefined ? Number(coach.fees.offline) : 599)
        : (coach.fees?.online !== undefined ? Number(coach.fees.online) : (Number(coach.price) || 299));

    let distanceInKM = 0;
    let extraDistanceCharge = 0;
    let freeKM = 5;

    // 🚗 Distance Surcharge for Offline In-Person / Hospital Visits
    if (isOffline) {
        try {
            const distanceConfig = await CoachDistanceConfig.findOne({ isActive: true }).lean();
            freeKM = distanceConfig?.freeDistanceKM !== undefined ? Number(distanceConfig.freeDistanceKM) : 5;
            const pricePerKM = distanceConfig?.pricePerKM !== undefined ? Number(distanceConfig.pricePerKM) : 15;

            if (userLat && userLng && coach.location?.lat && coach.location?.lng) {
                distanceInKM = calculateHaversine(
                    Number(userLat), Number(userLng),
                    Number(coach.location.lat), Number(coach.location.lng)
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

    // 💎 Premium Slot Check
    let isPremium = false;
    let extraSlotFee = 0;

    if (slotTime && Array.isArray(coach.slotConfig?.premiumSlots)) {
        const matchedPremium = coach.slotConfig.premiumSlots.find(p =>
            p.time === slotTime || (typeof slotTime === 'string' && slotTime.startsWith(p.time))
        );

        if (matchedPremium && Number(matchedPremium.extraFee) > 0) {
            isPremium = true;
            extraSlotFee = Number(matchedPremium.extraFee);
        }
    }

    const totalPayable = basePrice + extraDistanceCharge + extraSlotFee;

    return {
        coachSummary: {
            _id: coach._id,
            name: coach.name,
            qualification: coach.qualification,
            profileImage: coach.profileImage,
            coachType: coach.coachType,
            phone: coach.phone,
            rating: coach.rating || 4.9
        },
        pricing: {
            consultationMode: isOffline ? 'Offline' : 'Online',
            baseFee: basePrice,
            distanceInKM: Number(distanceInKM.toFixed(1)),
            freeDistanceIncludedKM: freeKM,
            extraDistanceCharge,
            isPremiumSlot: isPremium,
            premiumExtraFee: extraSlotFee,
            subtotal: totalPayable,
            discountAmount: 0,
            totalPayable
        }
    };
};

// =========================================================================
// 🧮 1. CALCULATE BILL / CHECKOUT PREVIEW API
// Endpoint: POST /api/user/coach-booking/calculate-bill
// =========================================================================
const calculateCoachBill = async (req, res) => {
    try {
        const {
            coachId,
            consultationMode = 'Online',
            scheduledDate,
            slotTime,
            userLat,
            userLng,
            locationType = 'Online',
            hospitalDetails = null,
            bookingFor = 'Self',
            patientDetails = null,
            specialInstructions = ""
        } = req.body;

        if (!coachId || !scheduledDate || !slotTime) {
            return res.status(400).json({
                success: false,
                message: "coachId, scheduledDate, and slotTime are required."
            });
        }

        const fare = await calculateCoachFareHelper({
            coachId,
            consultationMode,
            scheduledDate,
            slotTime,
            userLat,
            userLng
        });

        res.status(200).json({
            success: true,
            message: "Coach booking fare calculated successfully.",
            data: {
                ...fare,
                bookingOverview: {
                    bookingFor,
                    scheduledDate,
                    slotTime,
                    locationType,
                    specialInstructions: specialInstructions.trim(),
                    hospitalDetails: locationType === 'Hospital' ? hospitalDetails : null
                }
            }
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🛍️ 2. BOOK COACH / PLACE BOOKING API (COD or Online)
// Endpoint: POST /api/user/coach-booking/book
// =========================================================================
const bookDiabetesCoach = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            coachId,
            bookingFor = 'Self',
            patientDetails,
            consultationMode = 'Online',
            scheduledDate,
            slotTime,
            specialInstructions = "",
            locationType = 'Online',
            address,
            hospitalDetails,
            otherLocationDetails = "",
            paymentMethod = 'COD'
        } = req.body;

        // 1. Mandatory Validations
        if (!coachId || !scheduledDate || !slotTime) {
            return res.status(400).json({
                success: false,
                message: "coachId, scheduledDate, and slotTime are required."
            });
        }

        // 2. Validate Hospital details if locationType is 'Hospital'
        if (locationType === 'Hospital' && (!hospitalDetails || !hospitalDetails.hospitalName || hospitalDetails.hospitalName.trim() === '')) {
            return res.status(400).json({
                success: false,
                message: "hospitalName is required when locationType is 'Hospital'."
            });
        }

        // 3. Slot Collision Check (Double booking prevention)
        const isAlreadyBooked = await DiabeticCoachBooking.findOne({
            coachId,
            scheduledDate,
            slotTime,
            status: { $in: ['Placed', 'Confirmed', 'In-Progress'] }
        });

        if (isAlreadyBooked) {
            return res.status(400).json({
                success: false,
                message: "The selected coach slot is already booked for this date & time. Please choose another slot."
            });
        }

        // 4. Resolve Patient Details (Self vs Other)
        let resolvedPatient = {};

        if (bookingFor === 'Self') {
            const user = await User.findById(userId).lean();
            if (!user) return res.status(404).json({ success: false, message: "User not found." });

            resolvedPatient = {
                name: user.name,
                phone: user.phone || req.body.patientDetails?.phone || "N/A",
                gender: user.gender || "Other",
                age: req.body.patientDetails?.age || null,
                relation: 'Self',
                isDiabetic: user.isDiabetic !== undefined ? Boolean(user.isDiabetic) : true,
                diabetesType: user.diabeticType || user.diabteticType || 'Type 2'
            };
        } else {
            // For Other Person
            if (!patientDetails || !patientDetails.name || !patientDetails.phone) {
                return res.status(400).json({
                    success: false,
                    message: "patientDetails (name, phone) are required when booking for another person."
                });
            }

            const isDiabetic = patientDetails.isDiabetic !== undefined 
                ? (patientDetails.isDiabetic === true || patientDetails.isDiabetic === 'true') 
                : true;

            resolvedPatient = {
                name: patientDetails.name.trim(),
                phone: patientDetails.phone.trim(),
                gender: patientDetails.gender || "Other",
                age: Number(patientDetails.age) || null,
                relation: patientDetails.relation || "Family/Friend",
                isDiabetic: isDiabetic,
                diabetesType: isDiabetic 
                    ? (patientDetails.diabetesType ? patientDetails.diabetesType.trim() : 'Type 2') 
                    : 'Non Diabetic'
            };
        }

        // 5. Calculate Fare
        const userLat = address?.lat || null;
        const userLng = address?.lng || null;

        const fare = await calculateCoachFareHelper({
            coachId,
            consultationMode,
            scheduledDate,
            slotTime,
            userLat,
            userLng
        });

        const totalPayable = fare.pricing.totalPayable;
        const bookingId = `DW-COACH-${Date.now().toString().slice(-6)}`;
        const sessionOtp = Math.floor(1000 + Math.random() * 9000).toString();

        let rzpOrder = null;
        if (paymentMethod === 'Online' && totalPayable > 0) {
            rzpOrder = await createRazorpayOrder(totalPayable, `coach_${bookingId}`);
        }

        const isAutoConfirmed = paymentMethod === 'COD' || totalPayable === 0;

        // 6. Create Booking Document
        const newBooking = await DiabeticCoachBooking.create({
            bookingId,
            userId,
            coachId,
            bookingFor,
            patientDetails: resolvedPatient,
            consultationMode,
            scheduledDate,
            slotTime,
            specialInstructions: specialInstructions.trim(),
            locationType: consultationMode === 'Online' ? 'Online' : locationType,
            address: consultationMode === 'Offline' ? {
                name: address?.name || resolvedPatient.name,
                phone: address?.phone || resolvedPatient.phone,
                houseNo: address?.houseNo || "",
                sector: address?.sector || "",
                landmark: address?.landmark || "",
                city: address?.city || "",
                state: address?.state || "",
                pincode: address?.pincode || "",
                lat: userLat,
                lng: userLng
            } : undefined,
            hospitalDetails: locationType === 'Hospital' ? {
                hospitalName: hospitalDetails?.hospitalName || "",
                floorNo: hospitalDetails?.floorNo || "",
                ward: hospitalDetails?.ward || "",
                bedNo: hospitalDetails?.bedNo || ""
            } : undefined,
            otherLocationDetails: locationType === 'Other' ? otherLocationDetails : "",
            pricing: fare.pricing,
            paymentMethod,
            paymentStatus: totalPayable === 0 ? 'Paid' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : null,
            status: isAutoConfirmed ? 'Confirmed' : 'Placed',
            sessionOtp,
            trackingTimeline: [{
                status: isAutoConfirmed ? 'Confirmed' : 'Placed',
                timestamp: new Date(),
                note: `Coach consultation booked successfully (${paymentMethod}). Mode: ${consultationMode}.`
            }]
        });

        // 7. Response
        if (paymentMethod === 'Online' && rzpOrder) {
            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: "Razorpay payment initiated.",
                key_id: process.env.RAZORPAY_KEY_ID,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                bookingId: newBooking.bookingId,
                totalPayable,
                data: newBooking
            });
        }

        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "Coach booked successfully (Cash On Delivery).",
            bookingId: newBooking.bookingId,
            sessionOtp: newBooking.sessionOtp,
            totalPayable,
            data: newBooking
        });

    } catch (error) {
        console.error("bookDiabetesCoach error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 💳 3. VERIFY RAZORPAY PAYMENT API (Online Bookings)
// Endpoint: POST /api/user/coach-booking/verify-payment
// =========================================================================
const verifyCoachPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                success: false,
                message: "bookingId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required."
            });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment verification failed. Invalid signature." });
        }

        const booking = await DiabeticCoachBooking.findOne({
            $or: [
                { bookingId: bookingId },
                ...(mongoose.Types.ObjectId.isValid(bookingId) ? [{ _id: bookingId }] : [])
            ],
            userId
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.transactionId = razorpayPaymentId;
        booking.status = 'Confirmed';

        booking.trackingTimeline.push({
            status: 'Confirmed',
            timestamp: new Date(),
            note: `Online payment of ₹${booking.pricing?.totalPayable || 0} verified successfully (Txn: ${razorpayPaymentId}). Booking confirmed!`
        });

        await booking.save();

        res.status(200).json({
            success: true,
            message: "Payment verified successfully! Coach booking is confirmed.",
            bookingId: booking.bookingId,
            paymentStatus: booking.paymentStatus,
            status: booking.status,
            sessionOtp: booking.sessionOtp,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📋 4. GET MY COACH BOOKINGS LIST (LIGHTWEIGHT CARDS VIEW)
// Endpoint: GET /api/user/coach-booking/my-bookings
// =========================================================================
const getMyCoachBookings = async (req, res) => {
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

        const totalDocs = await DiabeticCoachBooking.countDocuments(query);

        // 🎯 Sirf main-main summary fields select karein (Heavy timeline/hospital fields excluded)
        const bookings = await DiabeticCoachBooking.find(query)
            .select('_id bookingId coachId bookingFor patientDetails.name patientDetails.relation consultationMode scheduledDate slotTime locationType pricing.totalPayable paymentMethod paymentStatus status createdAt')
            .populate('coachId', 'name qualification profileImage coachType')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // 📱 Clean Lightweight Cards Format for Frontend
        const formattedBookings = bookings.map(b => ({
            _id: b._id,
            bookingId: b.bookingId,
            coach: {
                _id: b.coachId?._id || null,
                name: b.coachId?.name || "Diabetes Coach",
                qualification: b.coachId?.qualification || "Certified Diabetes Educator",
                profileImage: b.coachId?.profileImage || null,
                coachType: b.coachId?.coachType || "Both"
            },
            patient: {
                bookingFor: b.bookingFor || "Self",
                name: b.patientDetails?.name || "Patient",
                relation: b.patientDetails?.relation || "Self"
            },
            consultationMode: b.consultationMode || "Online",
            scheduledDate: b.scheduledDate,
            slotTime: b.slotTime,
            locationType: b.locationType || "Online",
            totalPayable: b.pricing?.totalPayable || 0,
            paymentMethod: b.paymentMethod || "COD",
            paymentStatus: b.paymentStatus || "Pending",
            status: b.status || "Placed",
            bookingDate: b.createdAt
        }));

        res.status(200).json({
            success: true,
            totalBookings: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedBookings.length,
            data: formattedBookings
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 5. GET SINGLE BOOKING COMPLETE DETAILS BY ID
// Endpoint: GET /api/user/coach-booking/booking/:id
// =========================================================================
const getCoachBookingById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const query = {
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { bookingId: id }
            ],
            userId
        };

        const booking = await DiabeticCoachBooking.findOne(query)
            .populate('coachId', 'name qualification profileImage phone email about languages rating location')
            .populate('userId', 'name phone email profilePic')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Coach booking not found." });
        }

        res.status(200).json({
            success: true,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🚫 6. CANCEL COACH BOOKING BY USER (WITH 100% REFUND PIPELINE)
// Endpoint: PATCH /api/user/coach-booking/cancel/:id
// =========================================================================
const cancelCoachBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { cancelReason = "" } = req.body;

        const query = {
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { bookingId: id }
            ],
            userId
        };

        const booking = await DiabeticCoachBooking.findOne(query);

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        if (booking.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This booking is already cancelled." });
        }

        if (booking.status === 'Completed') {
            return res.status(400).json({ success: false, message: "Completed sessions cannot be cancelled." });
        }

        const reasonText = cancelReason.trim() !== '' 
            ? cancelReason.trim() 
            : "Cancelled by user before session.";

        const isOnlinePaid = booking.paymentMethod === 'Online' && booking.paymentStatus === 'Paid';
        const totalAmount = booking.pricing?.totalPayable || 0;

        booking.status = 'Cancelled';
        booking.paymentStatus = isOnlinePaid ? 'Refund-Pending' : booking.paymentStatus;

        booking.cancellationDetails = {
            isCancelled: true,
            cancelledBy: 'User',
            reason: reasonText,
            cancelledAt: new Date(),
            refundAmount: isOnlinePaid ? totalAmount : 0, // 100% Refund
            refundStatus: isOnlinePaid ? 'Pending' : 'Not Applicable',
            refundedAt: null,
            razorpayRefundId: null
        };

        booking.trackingTimeline.push({
            status: 'Cancelled',
            timestamp: new Date(),
            note: `Booking cancelled by user. ${isOnlinePaid ? '100% refund initiated for Admin processing.' : ''} Reason: ${reasonText}`
        });

        await booking.save();

        res.status(200).json({
            success: true,
            message: isOnlinePaid 
                ? "Coach booking cancelled successfully! 100% refund has been submitted to Admin for processing." 
                : "Coach booking cancelled successfully!",
            bookingId: booking.bookingId,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            cancellationDetails: booking.cancellationDetails,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    calculateCoachBill,
    bookDiabetesCoach,
    verifyCoachPayment,
    getMyCoachBookings,
    getCoachBookingById,
    cancelCoachBooking
};

