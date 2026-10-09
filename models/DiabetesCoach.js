// models/DiabetesCoach.js
const mongoose = require('mongoose');

const diabetesCoachSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Coach name is required"],
        trim: true
    },
    profileImage: {
        type: String,
        default: null
    },
    // 🎓 Qualification & Professional Specialization
    qualification: { 
        type: String, 
        default: "Certified Diabetes Educator" 
    },
    coachType: { 
        type: String, 
        enum: ['Diabetes Educator', 'Diabetes Coach', 'Both'], 
        default: 'Both',
        index: true 
    },
    price: {
        type: Number,
        required: [true, "Consultation / training charge is required"],
        min: 0
    }, // Consultation / Device onboarding charge in ₹

    // 💳 Online & Offline Consultation Fees
    fees: {
        online: { type: Number, default: 299, min: 0 },
        offline: { type: Number, default: 599, min: 0 }
    },
    consultationModes: {
        isOnlineAvailable: { type: Boolean, default: false },
        isOfflineAvailable: { type: Boolean, default: false }
    },

    // 🚗 Offline Travel / Distance Pricing (Beyond Base Range Surcharge)
    offlinePricing: {
        baseDistanceKM: { type: Number, default: 5 },     // Base included KM (e.g. 5 KM)
        extraPricePerKM: { type: Number, default: 15 },   // Extra charge per KM beyond base distance
        maxServiceRadiusKM: { type: Number, default: 25 } // Max distance coach will travel
    },
    phone: { 
        type: String, 
        unique: true, 
        sparse: true, 
        trim: true,
        default: null 
    },
    email: { 
        type: String, 
        unique: true, 
        sparse: true, 
        lowercase: true, 
        trim: true,
        default: null 
    },
    about: {
        type: String,
        default: ""
    }, // Guidance on device usage, sensor application, glucose monitoring
    languages: [{
        type: String
    }], // e.g. ["Hindi", "English", "Punjabi"]

    // 🔐 Authentication & Login Credentials
    password: {
        type: String,
        required: [true, "Login password is required"],
        select: false // Security: Queries mein password accidentally leak nahi hoga
    },
    role: {
        type: String,
        default: "diabetes-coach",
        immutable: true
    },
    token: {
        type: String,
        default: null
    },
    fcmToken: {
        type: String,
        default: null
    },

    // 📍 Location Coordinates & Address (For finding nearby coaches)
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 },
        address: { type: String, default: "" },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        pincode: { type: String, default: "" }
    },
    // ⏰ Slots & Availability Settings (Configured by Admin)
    slotConfig: {
        startTime: { type: String, default: "09:00" },
        endTime: { type: String, default: "20:00" },
        slotDuration: { type: Number, default: 30 }, // In minutes (e.g. 30, 45, 60)
        morningSlots: { type: Boolean, default: true },
        afternoonSlots: { type: Boolean, default: true },
        eveningSlots: { type: Boolean, default: true },
        premiumSlots: [{
            time: { type: String, required: true },     // e.g. "18:00"
            extraFee: { type: Number, default: 0 }      // Extra charge (e.g. +₹150)
        }],
        unavailableSlots: [{ type: String }],           // Lunch/break slots e.g. ["13:00", "13:30"]
        offDays: [{ type: String }],                    // e.g. ["Sunday"]
        blockedDates: [{ type: String }]                // Holidays e.g. ["2026-10-15"]
    },
    rating: {
        type: Number,
        default: 4.9
    },
    totalReviews: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

diabetesCoachSchema.index({ name: 'text', 'location.city': 'text' });

module.exports = mongoose.model('DiabetesCoach', diabetesCoachSchema);