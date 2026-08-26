// models/FoodAddon.js
const mongoose = require('mongoose');

const foodAddonSchema = new mongoose.Schema({
    // E.g., "Eco-friendly Wooden Spoon & Fork Set", "Extra Reusable Bowl", "Tiffin Carry Bag"
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    // Unit Price in ₹ (E.g., 5, 10, 20)
    price: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    description: { 
        type: String, 
        default: "" 
    },
    imageUrl: { 
        type: String, 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('FoodAddon', foodAddonSchema);