const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    
    // --- LAB SECTION ---
    labCart: {
        labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
        categoryType: { type: String, default: null },
        // 🚨 NEW: Selected Patients tracker to persist selections across app restarts/back navigation
        selectedPatients: [{
            patientId: { type: String, required: true }, // 'Self' or family member ID
            name: { type: String },
            age: { type: Number },
            gender: { type: String },
            relation: { type: String }
        }],
        items: [{
            productType: { 
                type: String, 
                enum: ['LabTest', 'LabPackage'], // <--- Inhe Change Karein
                required: true 
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId, 
                refPath: 'labCart.items.productType', // Dynamic reference path remains intact
                required: true 
            },
            name: String,
            price: Number,
            quantity: { type: Number, default: 1 }
        }]
    },

    // --- PHARMACY SECTION (Skeleton for future use) ---
    pharmacyCart: {
        pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy' },
        items: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
            name: String,
            price: Number,
            quantity: { type: Number, default: 1 },
            duration: String, // "5 Days"
            startDate: Date,

            // 🚨 ADDED: To strictly separate normal vs combo items in the same cart [1]
            isComboApplied: { type: Boolean, default: false },
            comboOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmacyComboOffer', default: null }

        }]
    },

    // --- FOOD (KITCHEN & DIET TILES) SECTION ---
    foodCart: {
        foodId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Food',
            default: null
        },
        bookingType: { 
            type: String, 
            enum: ['One day One Time', 'For Multiple Days', 'Acc. To Per/Hours'],
            default: 'One day One Time' 
        },
        items: [{
            productType: {
                type: String,
                enum: ['MealItem', 'Combo'],
                required: true,
                default: 'MealItem'
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId,
                required: true 
            },
            name: { 
                type: String, 
                required: true 
            },
            price: { 
                type: Number, 
                required: true 
            },
            quantity: { 
                type: Number, 
                default: 1 
            },
            mealType: { 
                type: String, 
                enum: ['Single Meal', 'Weekly Subscription', 'Monthly Subscription'],
                required: true 
            },
            isComboApplied: { 
                type: Boolean, 
                default: false 
            },
            comboOfferId: { 
                type: mongoose.Schema.Types.ObjectId, 
                ref: 'FoodComboOffer', 
                default: null 
            },
            startDate: { type: Date, default: null },
            endDate: { type: Date, default: null },
            preferredTime: { type: String, default: null },
            daysMultiplier: { type: Number, default: 1 }
        }]
    }

}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);