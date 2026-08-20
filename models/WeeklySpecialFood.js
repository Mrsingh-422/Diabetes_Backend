// models/WeeklySpecial.js
const mongoose = require('mongoose');

const weeklySpecialSchema = new mongoose.Schema({
    // E.g., 'monday', 'tuesday', 'wednesday' etc. (lowercased)
    dayOfWeek: { 
        type: String, 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 
        required: true, 
        unique: true 
    },
    // Array of selected FoodService items for that specific day
    meals: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodService' 
    }]
}, { timestamps: true });

module.exports = mongoose.model('WeeklySpecial', weeklySpecialSchema);