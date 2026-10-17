// models/DiabeticCoachBooking.js
const mongoose = require('mongoose');

const diabeticCoachBookingSchema = new mongoose.Schema({
    bookingId: { 
        type: String, 
        unique: true, 
        required: true,
        index: true 
    }, // e.g. "DW-COACH-102934"
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    coachId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'DiabetesCoach', 
        required: true,
        index: true 
    },

    // 1. Patient Details (Self vs Other)
    bookingFor: {
        type: String,
        enum: ['Self', 'Other'],
        default: 'Self'
    },
    patientDetails: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        age: { type: Number },
        relation: { type: String, default: 'Self' }, // 'Self', 'Father', 'Mother', 'Spouse', etc.
        
        // 🩸 Diabetic Status Check
        isDiabetic: { 
            type: Boolean, 
            default: true 
        },
        diabetesType: { 
            type: String,
            enum: [
                'Type 1', 'Type 2', 'Pre-diabetic', 'Gestational', 
                'Type 1 Diabetic', 'Type 2 Diabetic', 'Pre-Diabetic', 
                'Non Diabetic', 'Don’t Know', "Don't Know", 'Other'
            ],
            default: 'Type 2'
        }
    },

    // 2. Consultation Schedule & Mode
    consultationMode: { 
        type: String, 
        enum: ['Online', 'Offline'], 
        default: 'Online' 
    },
    scheduledDate: { 
        type: String, 
        required: true 
    }, // e.g. "2026-10-25"
    slotTime: { 
        type: String, 
        required: true 
    }, // e.g. "10:30 AM"

    // 3. User Specific Instructions for Coach
    specialInstructions: { 
        type: String, 
        default: "" 
    },

    // 4. Consultation Location (Home vs Hospital vs Other)
    locationType: {
        type: String,
        enum: ['Online', 'Home', 'Hospital', 'Other'],
        default: 'Online'
    },
    address: {
        name: { type: String },
        phone: { type: String },
        houseNo: { type: String },
        sector: { type: String },
        landmark: { type: String },
        city: { type: String },
        state: { type: String },
        pincode: { type: String },
        lat: { type: Number },
        lng: { type: Number }
    },
    // 🛏️ Hospital Specific Details
    hospitalDetails: {
        hospitalName: { type: String },
        floorNo: { type: String },
        ward: { type: String },
        bedNo: { type: String }
    },
    otherLocationDetails: {
        type: String,
        default: ""
    },

    // 5. Pricing Breakdown
    pricing: {
        baseFee: { type: Number, required: true },
        distanceInKM: { type: Number, default: 0 },
        freeDistanceIncludedKM: { type: Number, default: 5 },
        extraDistanceCharge: { type: Number, default: 0 },
        isPremiumSlot: { type: Boolean, default: false },
        premiumExtraFee: { type: Number, default: 0 },
        subtotal: { type: Number, required: true },
        discountAmount: { type: Number, default: 0 },
        totalPayable: { type: Number, required: true }
    },

    // 6. Payment & Verification
    paymentMethod: { 
        type: String, 
        enum: ['COD', 'Online'], 
        default: 'COD' 
    },
    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded', 'Refund-Pending'], 
        default: 'Pending' 
    },
    transactionId: { 
        type: String, 
        default: null 
    },
    status: { 
        type: String, 
        enum: ['Placed', 'Confirmed', 'In-Progress', 'Completed', 'Cancelled'], 
        default: 'Placed' 
    },
    sessionOtp: { 
        type: String, 
        default: null 
    }, // 4-digit verification code

    // 7. Cancellation & 100% Refund
    cancellationDetails: {
        isCancelled: { type: Boolean, default: false },
        cancelledBy: { type: String, enum: ['User', 'Coach', 'Admin'] },
        reason: { type: String, default: "" },
        cancelledAt: { type: Date, default: null },
        refundAmount: { type: Number, default: 0 },
        refundStatus: { 
            type: String, 
            enum: ['Not Applicable', 'Pending', 'Processed', 'Failed'], 
            default: 'Not Applicable' 
        },
        refundedAt: { type: Date, default: null },
        razorpayRefundId: { type: String, default: null }
    },

    trackingTimeline: [{
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        note: { type: String, default: "" }
    }]

}, { timestamps: true });

diabeticCoachBookingSchema.index({ coachId: 1, scheduledDate: 1, slotTime: 1 });
diabeticCoachBookingSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('DiabeticCoachBooking', diabeticCoachBookingSchema);