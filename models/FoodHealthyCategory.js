// models/FoodHealthyCategory.js
const mongoose = require('mongoose');

const foodHealthyCategorySchema = new mongoose.Schema({
    mainCategory: { 
        type: String, 
        required: true, 
        trim: true,
        unique: true // e.g., 'Men', 'Women', 'Child', 'Old'
    },
    subCategories: [{
        name: { 
            type: String, 
            required: true, 
            trim: true // e.g., 'Heart Healthy', 'Keto Flex', 'Diabetic', 'Weight Loss', 'Detox'
        },
        description: { type: String, default: "" },
        tagline: { type: String, default: "" } // e.g., "Contains less than 600mg sodium"
    }],
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('FoodHealthyCategory', foodHealthyCategorySchema);