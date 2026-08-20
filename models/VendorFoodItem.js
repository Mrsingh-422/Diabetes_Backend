// models/VendorFoodItem.js
const mongoose = require('mongoose');

const vendorFoodItemSchema = new mongoose.Schema({
    // Ref to your Food.js vendor schema
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', 
        required: true,
        index: true
    },
    // Ref to your FoodService.js master catalog schema
    foodServiceId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodService', 
        required: true,
        index: true
    },
    
    // 🚨 Custom pricing (Optional fallback: agar null hai toh master catalog price use hoga)
    price: { 
        type: Number, 
        default: null 
    }, 
    discountPrice: { 
        type: Number, 
        default: null 
    },

    // 🚨 Availability Controls mapping your requirements:
    isSelected: { 
        type: Boolean, 
        default: false 
    }, // True if vendor added this item to their active menu
    
    isOutOfStock: { 
        type: Boolean, 
        default: false 
    } // True if vendor temporarily marks it out of stock
}, { timestamps: true });

// Ensures a vendor can map a master dish only once
vendorFoodItemSchema.index({ vendorId: 1, foodServiceId: 1 }, { unique: true });

module.exports = mongoose.model('VendorFoodItem', vendorFoodItemSchema);