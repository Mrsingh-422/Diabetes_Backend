// models/FoodHealthyPlans.js
const mongoose = require('mongoose');

const foodHealthyPlansSchema = new mongoose.Schema({
    planId: { 
        type: String, 
        unique: true, 
        required: true 
    }, // Auto-generated e.g. HLP-101
    title: { 
        type: String, 
        required: true, 
        trim: true 
    }, // e.g., "Keto Flex Weight Loss Plan"
    description: { 
        type: String, 
        required: true 
    },
    tagline: { 
        type: String, 
        default: "" 
    }, // Highlight subtext below title

    // Step 1: Category Mapping
    mainCategory: { 
        type: String, 
        required: true,
        trim: true // 'Men', 'Women', 'Child', 'Old'
    },
    subCategory: { 
        type: String, 
        required: true,
        trim: true // 'Keto Flex', 'Heart Healthy', 'Diabetic', etc.
    },

    // Step 3: Days & Program Selection
    programType: {
        type: String,
        enum: ['Full Program', 'Lunches & Dinners', 'Breakfast & Lunch', 'Custom'],
        default: 'Full Program'
    },
    daysCount: { 
        type: Number, 
        required: true, 
        min: 1 
    }, // 2, 3, 5, 7, 10, 14, 28 Days (No limit)

    // 🗓️ DAY-WISE MEALS SCHEDULE (Day 1, Day 2, Day 3... with Breakfast, Lunch, Dinner)
    dayWiseSchedule: [{
        dayNumber: { 
            type: Number, 
            required: true 
        }, // 1, 2, 3, 4, 5, 6, 7, 8...
        dayName: { 
            type: String, 
            default: "" 
        }, // "Day 1", "Day 2", etc.
        breakfast: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodService'
        }],
        lunch: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodService'
        }],
        dinner: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodService'
        }]
    }],

    // 🔁 7-Day Repeat Option Switch (Agar true ho toh 7 din ke baad Day 8, 9... auto repeat honge)
    isRepeatAfter7Days: { 
        type: Boolean, 
        default: false 
    },

    // Step 2: Media Files
    bannerImage: { 
        type: String, 
        default: null 
    }, // 1 Main Banner Image
    images: [{ 
        type: String 
    }], // Multiple Showcase Images Array

    // Pricing Details
    pricing: {
        pricePerMeal: { type: Number, required: true, min: 0 },
        discountPricePerMeal: { type: Number, default: 0, min: 0 },
        totalPrice: { type: Number, required: true, min: 0 }, // Regular Price
        discountTotalPrice: { type: Number, default: 0, min: 0 }, // First Week / Promo Price
        savingsAmount: { type: Number, default: 0 }
    },

    // Nutritional / Clinical Highlights (From Screenshot)
    nutritionalHighlights: {
        maxSodium: { type: String, default: "" },      // e.g., "< 600mg"
        maxSaturatedFat: { type: String, default: "" }, // e.g., "< 3.5g"
        caloriesAvgPerDay: { type: Number, default: 0 }
    },

    isPopular: { type: Boolean, default: false },
    isRecommended: { type: Boolean, default: false },
    
    //  SOFT DELETE & LIFECYCLE FIELDS
    isDeleted: { 
        type: Boolean, 
        default: false,
        index: true 
    },
    deletedAt: { 
        type: Date, 
        default: null 
    },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('FoodHealthyPlans', foodHealthyPlansSchema);