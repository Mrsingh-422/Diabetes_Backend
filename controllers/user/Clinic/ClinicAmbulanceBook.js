// controllers/user/Ambulance/ClinicAmbulanceBook.js

const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Clinic = require('../../../models/Clinic');
const { getDistance } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature } = require('../../../utils/razorpay');
const crypto = require('crypto');

// Private Helper: Calculate exact fare dynamically
const calculateFareHelper = async (ambulanceId, rideType, distance = 0) => {
    const amb = await Ambulance.findById(ambulanceId);
    if (!amb) throw new Error("Ambulance vehicle not found");

    // Choose base fare according to Ride Type [1]
    const baseRideCharge = rideType === 'Double Ride' 
        ? amb.pricing.doubleRidePrice 
        : amb.pricing.singleRidePrice;

    let distanceCharge = 0;
    const baseDistance = amb.pricing.baseDistance || 5;

    if (distance > baseDistance) {
        distanceCharge = (distance - baseDistance) * (amb.pricing.pricePerKM || 12);
    }

    const subtotal = baseRideCharge + distanceCharge;

    return {
        baseRideCharge,
        distanceCharge,
        subtotal,
        total: subtotal
    };
};

// 1. GET FARE DETAILS (Figma Checkout Card)
const getClinicAmbulanceFare = async (req, res) => {
    try {
        const { ambulanceId, rideType, distance } = req.body;

        if (!ambulanceId || !rideType) {
            return res.status(400).json({ success: false, message: "ambulanceId and rideType are required." });
        }

        const fare = await calculateFareHelper(ambulanceId, rideType, distance || 0);
        res.json({ success: true, data: fare });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. INITIATE BOOKING (Razorpay Payment Order Step 1)
const bookClinicAmbulance = async (req, res) => {
    try {
        const { 
            ambulanceId, clinicId, rideType, pickupLocation, dropoffLocation, 
            patientDetails, distance, paymentMethod 
        } = req.body;

        if (!ambulanceId || !clinicId || !rideType) {
            return res.status(400).json({ success: false, message: "Missing required fields." });
        }

        const fare = await calculateFareHelper(ambulanceId, rideType, distance || 0);
        const tempBookingId = `HK-BOK-${Date.now().toString().slice(-6)}`;

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(fare.total, `receipt_${tempBookingId}`);
        }

        const booking = await Booking.create({
            bookingId: tempBookingId,
            userId: req.user.id,
            ambulanceId,
            clinicId,
            rideType,
            pickupLocation,
            dropoffLocation,
            patientDetails,
            pricing: {
                baseRideCharge: fare.baseRideCharge,
                distanceCharge: fare.distanceCharge,
                subtotal: fare.subtotal,
                total: fare.total
            },
            paymentMethod,
            paymentStatus: 'Pending',
            status: paymentMethod === 'COD' ? 'Confirmed' : 'Searching',
            transactionId: rzpOrder ? rzpOrder.id : null,
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{ 
                status: 'Searching', 
                timestamp: new Date(), 
                note: "Request sent. Finding driver." 
            }]
        });

        if (paymentMethod === 'COD') {
            return res.status(201).json({ success: true, message: "Ride booked with COD", data: booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created for ambulance ride.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: tempBookingId
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. VERIFY PAYMENT (Confirm Ride Step 2)
const verifyAmbulancePayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const booking = await Booking.findByIdAndUpdate(
            appointmentId,
            {
                $set: {
                    status: 'Confirmed',
                    paymentStatus: 'Paid',
                    transactionId: razorpayPaymentId
                }
            },
            { new: true }
        );

        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        res.json({
            success: true,
            message: "Ambulance payment verified. Ride confirmed!",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinicAmbulanceFare,
    bookClinicAmbulance,
    verifyAmbulancePayment
};