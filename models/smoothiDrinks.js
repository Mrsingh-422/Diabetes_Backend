// models/smoothiDrinks.js
const mongoose = require('mongoose');

const smoothiDrinksSchema = new mongoose.Schema({
    // 1. VENDOR & CATEGORY RELATIONS
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food',
        default: null,
        index: true
    },
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodCategory', 
        default: null,
        index: true
    },

    // 2. BASIC DRINK METADATA
    name: { 
        type: String, 
        required: true, 
        trim: true,
        index: true
    }, // e.g. "Avocado Green Detox Smoothie"
    description: { 
        type: String, 
        required: true 
    },
    
    // 🖼️ Multiple Images Array (Upload multiple drink photos)
    images: [{ 
        type: String, 
        required: true 
    }],
    
    // 3. PRICING DETAILS (discountPrice <= price)
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

    // 4. PREPARATION DETAILS (No spicyLevel)
    prepTime: { 
        type: Number, 
        required: true,
        default: 10 
    }, // in minutes
    servingSize: { 
        type: String, 
        default: "300ml" 
    }, // e.g. "300ml", "500ml", "1 Bottle", "1 Glass"
    drinkType: {
        type: String,
        enum: ['Smoothie', 'Cold-Pressed Juice', 'Detox Drink', 'Protein Shake', 'Immunity Booster', 'Herbal Tea'],
        default: 'Smoothie'
    },
    dietType: { 
        type: String, 
        enum: ['Veg', 'Vegan', 'Egg', 'Non Veg'], 
        default: 'Vegan',
        required: true 
    },
    
    // 5. INGREDIENTS WITH NUTRITIONAL BREAKDOWN
    ingredients: [{ 
        name: { type: String, required: true, trim: true }, // e.g. "Spinach", "Almond Milk", "Chia Seeds"
        quantity: { type: String, default: "" },             // e.g. "50g", "150ml", "1 tbsp"
        calories: { type: Number, default: 0, min: 0 }      // Individual ingredient calories
    }], 
    tags: [{ 
        type: String, 
        trim: true 
    }], // e.g. ["Sugar-Free", "Cold-Pressed", "High Fiber", "Antioxidant Rich", "Keto"]

    // 6. CLINICAL & NUTRITIONAL PROFILE (Auto-calculated total calories)
    calories: { 
        type: Number, 
        required: true,
        default: 0 
    }, 
    sugar: {
        type: Number,
        default: 0
    }, // Sugar content in grams (Critical for diabetes/drinks)
    glycemicIndex: { 
        type: Number, 
        default: 0 
    }, 
    netCarbs: { 
        type: Number, 
        default: 0 
    }, 
    sodium: { 
        type: Number, 
        default: 0 
    }, 
    potassium: { 
        type: Number, 
        default: 0 
    }, 
    phosphorus: { 
        type: Number, 
        default: 0 
    },

    // Health / Medical Focus
    foodEffectCategory: { 
        type: String, 
        required: true 
    }, // e.g. "Diabetes Care", "Weight Management", "Detox & Gut Health", "Heart Healthy"

    // 7. AVAILABILITY & ADMINISTRATIVE STATES
    isAvailable: { 
        type: Boolean, 
        default: true 
    }, 
    isActive: { 
        type: Boolean, 
        default: true 
    }, 
    isPopular: { 
        type: Boolean, 
        default: false 
    }, 
    isRecommended: { 
        type: Boolean, 
        default: false 
    }, 
    stockCount: { 
        type: Number, 
        default: 0 
    } 

}, { timestamps: true });

smoothiDrinksSchema.index({ name: 'text', description: 'text', 'ingredients.name': 'text' });

module.exports = mongoose.model('smoothiDrinks', smoothiDrinksSchema);