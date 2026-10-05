// models/DeviceCategory.js
const mongoose = require('mongoose');

const deviceCategorySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, "Category name is required"], 
        trim: true,
        unique: true // e.g. "Glucometers", "CGM", "Supplements"
    },
    description: {
        type: String,
        default: ""
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('DeviceCategory', deviceCategorySchema);