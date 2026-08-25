// models/VendorTiffinPlan.js
const mongoose = require('mongoose');

const vendorTiffinPlanSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', 
        required: true,
        index: true
    },
    planId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'TiffinPlan', 
        required: true,
        index: true
    },
    
    // Custom pricing override (Optional fallback to admin plan price if null)
    customPrice: { 
        type: Number, 
        default: null 
    },

    // Availability status on vendor's kitchen menu
    isAvailable: { 
        type: Boolean, 
        default: false 
    }
}, { timestamps: true });

vendorTiffinPlanSchema.index({ vendorId: 1, planId: 1 }, { unique: true });

module.exports = mongoose.model('VendorTiffinPlan', vendorTiffinPlanSchema);