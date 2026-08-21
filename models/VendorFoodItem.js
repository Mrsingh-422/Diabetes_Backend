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
    
    // Custom pricing (Optional fallback to master catalog price if null)
    price: { 
        type: Number, 
        default: null 
    }, 
    discountPrice: { 
        type: Number, 
        default: null 
    },

    // 🚨 UPDATED KEY: Now 'isAvailable' represents active status on vendor's menu
    isAvailable: { 
        type: Boolean, 
        default: false 
    } 
}, { timestamps: true });

// Ensures a vendor can map a master dish only once
vendorFoodItemSchema.index({ vendorId: 1, foodServiceId: 1 }, { unique: true });

module.exports = mongoose.model('VendorFoodItem', vendorFoodItemSchema);