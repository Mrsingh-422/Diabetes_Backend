// models/FoodComboOffer.js
const mongoose = require('mongoose');

const foodComboOfferSchema = new mongoose.Schema({
    // Dynamic Unique ID (E.g. CMB-801, CMB-802)
    comboId: { 
        type: String, 
        unique: true, 
        required: true 
    }, 
    name: { 
        type: String, 
        required: true, 
        trim: true 
    }, // COMBO PACKAGE NAME
    description: { 
        type: String, 
        required: true 
    }, // BUNDLE DESCRIPTION
    
    // Pricing
    basePrice: { 
        type: Number, 
        required: true, 
        default: 0 
    }, // Calculated dynamically on backend (Sum of individual prices * qty)
    comboPrice: { 
        type: Number, 
        required: true 
    }, // COMBO DISCOUNT PRICE (₹)
    
    spicyLevel: { 
        type: String, 
        enum: ['Low (Mild)', 'Medium (Regular)', 'High'], 
        default: 'Medium (Regular)' 
    }, // SPICY LEVEL
    
    isPopular: { 
        type: Boolean, 
        default: false 
    }, // Popular Bundle Checkbox
    isRecommended: { 
        type: Boolean, 
        default: false 
    }, // Recommended Checkbox
    isActive: { 
        type: Boolean, 
        default: true 
    }, // Availability switch toggle

    // Many-to-Many Relationship Array mapping referenced dishes
    dishes: [{
        foodServiceId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'FoodService', 
            required: true 
        },
        quantity: { 
            type: Number, 
            default: 1 
        } // Configured Quantities panel (- 1 +)
    }]
}, { timestamps: true });

module.exports = mongoose.model('FoodComboOffer', foodComboOfferSchema);