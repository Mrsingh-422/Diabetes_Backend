// models/AmbulanceBooking.js
const mongoose = require('mongoose');

const ambulanceBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true, required: true },
    caseReference: { type: String, unique: true }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    
    // 🚨 FIX: clinicId ko optional (default: null) rakha hai taaki Independent Ambulance me error na aaye
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },

    // 🏷️ Booking Category ('Emergency' vs 'Referral')
    bookingCategory: {
        type: String,
        enum: ['Emergency', 'Referral'],
        default: 'Emergency'
    },

    // 🕒 Scheduled Ride Details (For Referral Flow)
    scheduledDate: { type: String, default: null }, // e.g. "2026-10-02"
    scheduledTime: { type: String, default: null }, // e.g. "10:00 AM - 12:00 PM"
    
       // ⏱ NEW: User Estimated Travel / Ride Duration
       estimateTime: { 
        type: String, 
        default: null 
    },

    rideType: { 
        type: String, 
        enum: ['Single Ride', 'Double Ride'], 
        default: 'Single Ride'
    },

    pickupLocation: {
        address: { type: String, default: "" },
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },
    dropoffLocation: {
        address: { type: String, default: "" },
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    patientDetails: {
        name: String,
        relation: String,
        age: Number,
        gender: String,
        condition: { type: String, default: 'Stable' },
        emergencyDescription: String
    },

    // 👨‍⚕️ Selected Support Staff Addons (Nurse, Doctor, Oxygen Cylinder etc.)
    supportStaff: [{
        facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'AmbulanceFacility', default: null },
        name: String,
        price: Number
    }],

    // 🎟️ Applied Coupon Details
    couponDetails: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
        couponCode: { type: String, default: "" },
        discountAmount: { type: Number, default: 0 }
    },

    otp: { type: String }, 
    isOtpVerified: { type: Boolean, default: false },

    status: { 
        type: String, 
        enum: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route', 'Dropped-Off', 'Completed', 'Cancelled'], 
        default: 'Searching' 
    },

    pricing: {
        baseRideCharge: { type: Number, default: 0 },
        distanceCharge: { type: Number, default: 0 },
        subtotal: { type: Number, default: 0 },
        discount: { type: Number, default: 0 }, 
        total: { type: Number, default: 0 }
    },

    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'], 
        default: 'Pending' 
    },
    paymentMethod: { type: String, enum: ['COD', 'Online'], default: 'COD' },
    transactionId: { type: String, default: null },

    trackingTimeline: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }]

}, { timestamps: true });

module.exports = mongoose.model('AmbulanceBooking', ambulanceBookingSchema);