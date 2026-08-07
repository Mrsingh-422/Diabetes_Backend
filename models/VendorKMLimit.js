const mongoose = require('mongoose');

const vendorKMLimitSchema = new mongoose.Schema({
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Food', 'Ambulance', 'Clinic'], 
        unique: true, 
        required: true 
    },
    kmLimit: { 
        type: Number, 
        required: true, 
        default: 50 // Default limit 50km
    },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('VendorKMLimit', vendorKMLimitSchema);