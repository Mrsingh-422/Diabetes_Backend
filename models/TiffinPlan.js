// models/TiffinPlan.js
const mongoose = require('mongoose');

const tiffinPlanSchema = new mongoose.Schema({
    // Auto-generated Unique ID (E.g., PLN-101, PLN-102)
    planId: { 
        type: String, 
        unique: true, 
        required: true 
    },
    // PLAN NAME (E.g., "1 Meal Anytime Plan", "2 Meals Daily Combo")
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    // PLAN CYCLE
    planCycle: { 
        type: String, 
        enum: ['Weekly Cycle', 'Monthly Cycle'], 
        default: 'Monthly Cycle',
        required: true 
    },
    // MEALS COUNT / DAY (E.g. 1, 2, 3)
    mealsPerDay: { 
        type: Number, 
        required: true,
        min: 1,
        max: 5
    },
    // SUBSCRIPTION PRICE (₹)
    price: { 
        type: Number, 
        required: true,
        min: 0 
    },
    // PERMITTED MEAL SLOTS Checkboxes (['Breakfast', 'Lunch', 'Dinner'])
    permittedSlots: [{ 
        type: String, 
        enum: ['Breakfast', 'Lunch', 'Dinner'],
        required: true 
    }],

    // 🚨 NEW: SLOT-WISE DISH POOL (Breakfast, Lunch, Dinner with Meals & Combos)
    slotDishes: {
        breakfast: [{
            itemType: { 
                type: String, 
                enum: ['FoodService', 'FoodComboOffer'], 
                default: 'FoodService' 
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId, 
                refPath: 'slotDishes.breakfast.itemType',
                required: true 
            }
        }],
        lunch: [{
            itemType: { 
                type: String, 
                enum: ['FoodService', 'FoodComboOffer'], 
                default: 'FoodService' 
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId, 
                refPath: 'slotDishes.lunch.itemType',
                required: true 
            }
        }],
        dinner: [{
            itemType: { 
                type: String, 
                enum: ['FoodService', 'FoodComboOffer'], 
                default: 'FoodService' 
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId, 
                refPath: 'slotDishes.dinner.itemType',
                required: true 
            }
        }]
    },

    // Retained for backward compatibility
    dishPool: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FoodService'
    }],

    // PLAN DESCRIPTION
    description: { 
        type: String, 
        required: true 
    },
    // Active subscriber count tracker
    activeSubscribers: { 
        type: Number, 
        default: 0 
    },
    // Status Switch (Active / Inactive)
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('TiffinPlan', tiffinPlanSchema);