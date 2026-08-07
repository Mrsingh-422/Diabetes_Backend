const mongoose = require('mongoose');

const foodProviderSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Outlet or Restaurant Name
    ownerName: { type: String, default: null }, // Owner or Manager name
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['Food'], default: 'Food', immutable: true },
    profileStatus: { type: String, enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], default: 'Incomplete' },
    token: { type: String, default: null },
    fcmToken: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },

    profileImage: { type: String, default: null }, // Logo or Main outlet image
    bannerImage: { type: String, default: null },  // Banner image for the app

    // Location Details
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    // Food Business Specific Documents & Licensing
    documents: {
        // --- Image Arrays ---
        outletImages: [{ type: String }],       // Images of the kitchen/dining area
        foodSafetyCertificates: [{ type: String }], // FSSAI or other safety certificates
        gstCertificates: [{ type: String }],
        otherCertificates: [{ type: String }],

        // --- Details Fields ---
        documentState: { type: String },
        issuingAuthority: { type: String },     // e.g., FSSAI, Municipal Corporation
        gstNumber: { type: String },
        experienceInYears: { type: Number, default: 0 },
        
        // Food/FSSAI License Details
        foodLicenseNumber: { type: String, default: "" }, // e.g., FSSAI License Number
        foodLicenseExpiry: { type: Date, default: null },
        
        // Food License Type (Replacing drugLicenseType)
        foodLicenseType: {
            type: String,
            enum: ['FSSAI Registration', 'FSSAI State License', 'FSSAI Central License', 'Municipal Trade License', 'None'],
            default: 'None'
        }
    },

    rejectionReason: { type: String, default: null },
    alternatePhone: { type: String, default: null },

    // --- Food Flow Specific Parameters ---
    businessType: { 
        type: String, 
        enum: ['Restaurant', 'Cloud Kitchen', 'Bakery', 'Cafe', 'Caterer', 'Street Food', 'Other'], 
        default: 'Restaurant' 
    },
    
    // Dietary and Cuisine Settings
    dietaryPreference: [{ 
        type: String, 
        enum: ['Veg', 'Non-Veg', 'Eggitarian', 'Vegan', 'Gluten-Free'], 
        default: ['Veg'] 
    }],
    cuisines: [{ type: String }], // e.g., ["North Indian", "Chinese", "Italian", "Desserts"]
    
    // Services
    isDeliveryAvailable: { type: Boolean, default: true },
    isDineInAvailable: { type: Boolean, default: false },
    isTakeawayAvailable: { type: Boolean, default: true },
    isPureVeg: { type: Boolean, default: false },
    isHalalCertified: { type: Boolean, default: false },
    is24x7: { type: Boolean, default: false },

    // Delivery Constraints
    deliveryRadiusKm: { type: Number, default: 5 }, // Serving area radius
    minOrderAmount: { type: Number, default: 0 },
    averageCostForTwo: { type: Number, default: 0 }, // Cost estimate for users
    packagingCharges: { type: Number, default: 0 },

    // Operating Hours (Day-wise timing configuration)
    operatingHours: [
        {
            day: { type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
            isOpen: { type: Boolean, default: true },
            openTime: { type: String, default: "09:00 AM" }, // Standard representation
            closeTime: { type: String, default: "11:00 PM" }
        }
    ],

    about: { type: String, default: "" },
    rating: { type: Number, default: 4.5 },
    hygieneRating: { type: Number, default: 4.0 }, // FSSAI hygiene rating if applicable
    totalReviews: { type: Number, default: 0 },

    // Payout and Bank Details
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

// Geo-spatial indexing for location-based search (Radius-based search features ke liye useful)
foodProviderSchema.index({ "location": "2dsphere" });

module.exports = mongoose.model('FoodProvider', foodProviderSchema);