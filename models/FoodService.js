// models/FoodService.js
const mongoose = require('mongoose');

const foodServiceSchema = new mongoose.Schema({
    // 1. VENDOR & CATEGORY RELATIONS
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food',
        required: false,
        default: null,
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
        index: true
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
    }, 
    servingSize: { 
        type: String, 
        default: "1 Person" 
    }, 
    spicyLevel: { 
        type: String, 
        default: 'Low (Mild)' 
    },
    dietType: { 
        type: String, 
        enum: ['Veg', 'Egg', 'Non Veg'], 
        required: true 
    },
    
    // 5. INGREDIENTS WITH DETAILED NUTRITIONAL BREAKDOWN
    ingredients: [{
        name: { 
            type: String, 
            required: true, 
            trim: true 
        }, // e.g. "Broccoli", "Olive Oil", "Chickpeas"
        quantity: { 
            type: String, 
            default: "" 
        }, // e.g. "100g", "1 tbsp", "50ml", "1 cup"
        calories: { 
            type: Number, 
            default: 0, 
            min: 0 
        } // Is individual ingredient ki calories (e.g. 55, 80)
    }],

    tags: [{ 
        type: String, 
        trim: true 
    }], 

    // 6. TOTAL CALORIES (Auto-summed from ingredients)
    calories: { 
        type: Number, 
        required: true,
        default: 0
    },

    // 🚨 Changed from medicalFocus to foodEffectCategory (UI dropdown mapping)
    foodEffectCategory: { 
        type: String, 
        required: true 
    },

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

foodServiceSchema.index({ name: 'text', description: 'text', ingredients: 'text' });

module.exports = mongoose.model('FoodService', foodServiceSchema);