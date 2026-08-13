// models/Food.js
const mongoose = require('mongoose');

const foodSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Kitchen or Brand Name
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['Food'], default: 'Food', immutable: true },
    profileStatus: { type: String, enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], default: 'Incomplete' },
    token: { type: String, default: null },
    fcmToken: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },
    alternatePhone: { type: String, default: null },

    profileImage: { type: String, default: null },

    // Location Details
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    documents: {
        // --- Image Arrays ---
        kitchenImages: [{ type: String }],          // Kitchen Photos
        fssaiCertificates: [{ type: String }],      // FSSAI Registration Docs
        gstCertificates: [{ type: String }],        // GST Certificate (Optional)
        otherCertificates: [{ type: String }],      // Other Certificates

        // --- Details Fields ---
        documentState: { type: String },            
        issuingAuthority: { type: String },         // FSSAI/Govt Authority Name
        gstNumber: { type: String },                
        fssaiNumber: { type: String }               // FSSAI License Number
    },

    rejectionReason: { type: String, default: null },

    // Food Specific Info
    cuisineSpecialities: [{ type: String }],        // e.g. ['Diabetic Diet', 'Low Sodium', 'Keto', 'General Healthy']
    about: { type: String, default: "" },
    rating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },

    // Dynamic Food Menus (Figma: Meals and subscriptions)
    offeredMeals: [{
        type: { type: String, enum: ['Single Meal', 'Weekly Subscription', 'Monthly Subscription'] },
        title: { type: String },                    // e.g., "Low-Salt Hypertension Lunch"
        description: { type: String },
        price: { type: Number },
        photos: [{ type: String }],
        isActive: { type: Boolean, default: true }
    }],

    bankDetails: {
        accountType: { type: String, enum: ['Savings', 'Current'], default: 'Savings' },
        bankName: { type: String, default: "" },
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        upiId: { type: String, default: "" },
        isVerified: { type: Boolean, default: false }
    }

}, { timestamps: true });

foodSchema.index({ location: "2dsphere" });

module.exports = mongoose.model('Food', foodSchema);