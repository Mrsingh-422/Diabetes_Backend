// models/DeliveryCharge.js
const mongoose = require('mongoose');

const deliveryChargeSchema = new mongoose.Schema({
    // 🚨 NO unique constraint here, so multiple locations can have vendorId: null
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        refPath: 'vendorType',
        default: null
    },
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Food', 'Doctor', 'All'], 
        default: 'Food' 
    },
    isAdminGlobal: { 
        type: Boolean, 
        default: false 
    },
    country: { type: String, default: 'India', trim: true },
    state: { type: String, default: null, trim: true },
    city: { type: String, default: null, trim: true },

    fixedPrice: { type: Number, default: 40 },
    fixedDistance: { type: Number, default: 5 },
    pricePerKM: { type: Number, default: 10 },
    rapidCharge: { type: Number, default: 25 },
    fastDeliveryExtra: { type: Number, default: 25 },
    isRapidAvailable: { type: Boolean, default: true },
    packagingCharge: { type: Number, default: 15 },
    freeDeliveryThreshold: { type: Number, default: 500 },
    taxPercentage: { type: Number, default: 5 },
    taxInRupees: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryCharge', deliveryChargeSchema);