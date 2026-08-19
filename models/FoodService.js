const mongoose = require('mongoose');

const foodServiceSchema = new mongoose.Schema({
    // 1. VENDOR & CATEGORY RELATIONS
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', // References the Kitchen/Brand Vendor
        required: true,
        index: true
    },
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodCategory', 
        default: null,
        index: true
    },

    // 2. BASIC FOOD METADATA
    name: { 
        type: String, 
        required: true, 
        trim: true,
        index: true // Fast case-insensitive text search ke liye
    },
    description: { 
        type: String, 
        required: true 
    },
    imageUrl: { 
        type: String, 
        default: null 
    },
    
    // 3. PRICING DETAILS (Admin validations rule: discountPrice <= price)
    price: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    discountPrice: { 
        type: Number, 
        default: 0,
        min: 0
    },

    // 4. KITCHEN PREPARATION DETAILS
    prepTime: { 
        type: Number, 
        required: true 
    }, // Preparation time in minutes (e.g., 15, 20)
    servingSize: { 
        type: String, 
        default: "1 Person" 
    }, // E.g., "350g", "1 Person"
    spicyLevel: { 
        type: Number, 
        min: 0, 
        max: 5, 
        default: 0 
    }, // Enforced range between 0 and 5
    dietType: { 
        type: String, 
        enum: ['Veg', 'Egg', 'Non Veg'], 
        required: true 
    },
    
    // 5. INGREDIENTS & SEARCH TAGS
    ingredients: [{ 
        type: String, 
        trim: true 
    }], // Stored as array for fast index intersection checks during search
    tags: [{ 
        type: String, 
        trim: true 
    }], // E.g., ["Keto", "Low GI", "High Fiber"]

    // 6. CLINICAL & NUTRITIONAL PROFILE (Most Critical for Admin Checks)
    calories: { 
        type: Number, 
        required: true 
    }, // Calories in Kcal
    glycemicIndex: { 
        type: Number, 
        default: 0 
    }, // Enforced validation check (< 53 for diabetic friendly classification)
    netCarbs: { 
        type: Number, 
        default: 0 
    }, // Carbs in grams (limit check: < 25g for diabetes care)
    sodium: { 
        type: Number, 
        default: 0 
    }, // Sodium in mg (limit check: < 140mg for hypertension care)
    potassium: { 
        type: Number, 
        default: 0 
    }, // Potassium in mg (limit check: < 200mg for kidney care)
    phosphorus: { 
        type: Number, 
        default: 0 
    }, // Phosphorus in mg (limit check: < 150mg for kidney care)

    // 7. AVAILABILITY & ADMINISTRATIVE STATES
    isAvailable: { 
        type: Boolean, 
        default: true 
    }, // Instantly toggle item availability on vendor dashboard
    isActive: { 
        type: Boolean, 
        default: true 
    }, // Admin block/unblock control state
    isPopular: { 
        type: Boolean, 
        default: false 
    }, // Frontend highlight badge
    isRecommended: { 
        type: Boolean, 
        default: false 
    }, // Frontend recommend badge
    stockCount: { 
        type: Number, 
        default: 0 
    } // Real-time inventory tracking for checkout validation

}, { timestamps: true });

// Case-insensitive compound index for search optimization
foodServiceSchema.index({ name: 'text', description: 'text', ingredients: 'text' });

module.exports = mongoose.model('FoodService', foodServiceSchema);