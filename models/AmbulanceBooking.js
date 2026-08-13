// models/AmbulanceBooking.js
const mongoose = require('mongoose');

const ambulanceBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true, required: true },
    caseReference: { type: String, unique: true }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true }, // 🚀 Clinic Reference

    // 🚀 NEW: Ride Specifications
    rideType: { 
        type: String, 
        enum: ['Single Ride', 'Double Ride'], 
        required: true 
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

    otp: { type: String }, 
    isOtpVerified: { type: Boolean, default: false },

    status: { 
        type: String, 
        enum: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route', 'Dropped-Off', 'Completed', 'Cancelled'], 
        default: 'Searching' 
    },

    pricing: {
        baseRideCharge: { type: Number, default: 0 }, // Based on Single or Double Ride choice
        distanceCharge: { type: Number, default: 0 },  // Extra KM charge
        subtotal: { type: Number, default: 0 },
        discount: { type: Number, default: 0 }, 
        total: { type: Number, default: 0 }           // Final amount
    },

    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'], 
        default: 'Pending' 
    },
    paymentMethod: { type: String, enum: ['COD', 'Online'], default: 'Online' },
    transactionId: { type: String, default: null },

    trackingTimeline: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }]

}, { timestamps: true });

module.exports = mongoose.model('AmbulanceBooking', ambulanceBookingSchema);