const mongoose = require('mongoose');

const foodCategorySchema = new mongoose.Schema({
    // Category Name (Removed unique restriction entirely)
    foodCategory: { 
        type: String, 
        trim: true 
    },
    
    // Maps the therapeutic health effect directly inside category schema (No Icon)
    foodEffectCategory: {
        type: String,
        default: null,
        trim: true
    }

}, { timestamps: true });

module.exports = mongoose.model('FoodCategory', foodCategorySchema);