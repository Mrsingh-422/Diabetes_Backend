// models/TodaySpecial.js
const mongoose = require('mongoose');

const todaySpecialSchema = new mongoose.Schema({
    // Link to the master FoodService catalog item
    foodItemId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodService', 
        required: true, 
        unique: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('TodaySpecial', todaySpecialSchema);