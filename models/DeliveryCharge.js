const mongoose = require('mongoose');

const deliveryChargeSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorType',
        unique: true 
    },
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Food', 'Doctor'], 
        required: true 
    },

    // Figma Screen 15 & Modal Fields (Defaults synced with your actual UI screenshots)
    fixedPrice: { type: Number, default: 40 },          // Home Delivery Charge (₹40)
    fixedDistance: { type: Number, default: 5 },        // Distance Threshold (5 KM)
    pricePerKM: { type: Number, default: 10 },          // Extra Rate per KM (₹10)
    fastDeliveryExtra: { type: Number, default: 25 },   // Fast Delivery Extra (₹25)
    
    //  ADDED: Packaging Container Fee (₹15) which was missing in your old schema
    packagingCharge: { type: Number, default: 15 },     

    // Extra Production Fields
    freeDeliveryThreshold: { type: Number, default: 500 }, // Free Delivery Minimum (₹500)
    taxPercentage: { type: Number, default: 5 },         // Tax Percentage (5%)
    taxInRupees: { type: Number, default: 0 }

}, { timestamps: true });

module.exports = mongoose.model('DeliveryCharge', deliveryChargeSchema);