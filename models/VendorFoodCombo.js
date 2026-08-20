// models/VendorFoodCombo.js
const mongoose = require('mongoose');

const vendorFoodComboSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', 
        required: true,
        index: true
    },
    foodComboId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodComboOffer', 
        required: true,
        index: true
    },
    
    // Vendor custom pricing for the combo bundle (Optional fallback to admin price)
    price: { 
        type: Number, 
        default: null 
    },

    // Availability States
    isSelected: { 
        type: Boolean, 
        default: false 
    }, // True if vendor selected this bundle to be offered
    
    isOutOfStock: { 
        type: Boolean, 
        default: false 
    } // True if temporarily out of stock
}, { timestamps: true });

vendorFoodComboSchema.index({ vendorId: 1, foodComboId: 1 }, { unique: true });

module.exports = mongoose.model('VendorFoodCombo', vendorFoodComboSchema);