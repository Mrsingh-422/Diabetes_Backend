// models/CGMAddon.js
const mongoose = require('mongoose');

const cgmAddonSchema = new mongoose.Schema({
    // E.g., "1-on-1 Diabetes Coach Session", "Waterproof Sensor Patch", "Alcohol Swabs Pack"
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    // Unit Price in ₹ (E.g. 99, 199, 299)
    price: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    // Coach Charge (₹)
    coachCharge: {
        type: Number,
        default: 0,
        min: 0
    },
    description: { 
        type: String, 
        default: "" 
    },
    imageUrl: { 
        type: String, 
        default: null 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('CGMAddon', cgmAddonSchema);