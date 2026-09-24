// models/VendorSmoothieDrink.js
const mongoose = require('mongoose');

const vendorSmoothieDrinkSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Food', 
        required: true,
        index: true
    },
    drinkId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'smoothiDrinks', 
        required: true,
        index: true
    },
    isAvailable: { 
        type: Boolean, 
        default: false 
    }
}, { timestamps: true });

vendorSmoothieDrinkSchema.index({ vendorId: 1, drinkId: 1 }, { unique: true });

module.exports = mongoose.model('VendorSmoothieDrink', vendorSmoothieDrinkSchema);