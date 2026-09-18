// models/VendorHealthyPlan.js
const mongoose = require('mongoose');

const vendorHealthyPlanSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', 
        required: true,
        index: true
    },
    healthyPlanId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodHealthyPlans', 
        required: true,
        index: true
    },
    isAvailable: { 
        type: Boolean, 
        default: false 
    }
}, { timestamps: true });

vendorHealthyPlanSchema.index({ vendorId: 1, healthyPlanId: 1 }, { unique: true });

module.exports = mongoose.model('VendorHealthyPlan', vendorHealthyPlanSchema);