// models/PeakOrderCharge.js
const mongoose = require('mongoose');

const peakOrderChargeSchema = new mongoose.Schema({
    vendorType: {
        type: String,
        enum: ['Food', 'All'],
        default: 'Food',
        unique: true
    },
    breakfast: {
        charge: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: false }
    },
    lunch: {
        charge: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: false }
    },
    dinner: {
        charge: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: false }
    },
    // Master Switch to turn ON/OFF all peak charges
    isGlobalActive: {
        type: Boolean,
        default: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('PeakOrderCharge', peakOrderChargeSchema);