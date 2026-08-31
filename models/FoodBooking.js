// models/FoodBooking.js
const mongoose = require('mongoose');

const foodBookingSchema = new mongoose.Schema({
    // Standard ID Format: ORD-XXXXXXXX / FD-XXXXXXXX / SUB-FD-XXXXXX
    bookingId: { type: String, unique: true, required: true }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Food', required: true }, // Kitchen/Brand ID

    bookingType: { 
        type: String, 
        enum: ['Direct', 'Subscription', 'Custom Plate'], 
        default: 'Direct' 
    },

    // A. DIRECT MEALS & COMBOS (Aggregator / Direct Orders)
    items: [{
        productType: { type: String, enum: ['MealItem', 'Combo'], required: true, default: 'MealItem' },
        itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        mealType: { type: String, enum: ['Single Meal', 'Weekly Subscription', 'Monthly Subscription'], default: 'Single Meal' },
        isComboApplied: { type: Boolean, default: false },
        comboOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodComboOffer', default: null }
    }],

    // 🍱 B. TIFFIN SUBSCRIBERS & SCHEDULES (Weekly, Monthly 4-Weeks, Custom Days)
    subscriptionDetails: {
        planId: { type: String, default: null }, // e.g. "PLN-103", "PLN-102", "custom-plan"
        planName: { type: String, default: "Custom Tiffin Plan" },
        billingCycle: { type: String, enum: ['weekly', 'monthly', 'custom'], default: 'weekly' },
        durationDays: { type: Number, default: 7 }, // 7 for Weekly, 30 for Monthly, or Custom (10, 15)
        startDate: { type: Date },
        endDate: { type: Date },

        // ⏰ Universal Delivery Time Preferences (From UI Dropdowns)
        universalDeliveryTimes: {
            breakfastTime: { type: String, default: "08:00 AM - 09:00 AM" },
            lunchTime: { type: String, default: "01:00 PM - 02:00 PM" },
            dinnerTime: { type: String, default: "08:00 PM - 09:00 PM" }
        },

        // 📅 Full Day-by-Day / Week-by-Week Scheduled Meals
        dailyMealSchedule: [{
            weekNumber: { type: Number, default: 1 }, // Week 1, Week 2, Week 3, Week 4
            dayOfWeek: { 
                type: String, 
                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 
                required: true 
            },
            slotName: { 
                type: String, 
                enum: ['breakfast', 'lunch', 'dinner'], 
                required: true 
            },
            mealId: { 
                type: mongoose.Schema.Types.ObjectId, 
                ref: 'FoodService', 
                required: true 
            },
            mealName: { type: String },
            mealImage: { type: String },
            mealPrice: { type: Number },
            calories: { type: Number },
            dietType: { type: String },
            deliveryTime: { type: String } // e.g. "01:00 PM - 02:00 PM"
        }],

        // 🛡️ Retained for Legacy / Simple Slot Subscriptions
        slotsConfiguration: [{
            slotName: { type: String, enum: ['breakfast', 'lunch', 'dinner'] },
            mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodService' },
            preferredTime: { type: String }
        }]
    },

    // C. CUSTOM PLATE WORKSPACE (Ingredient Level Assembly)
    customPlateSchedule: [{
        dayOfWeek: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
        slotName: { type: String, enum: ['breakfast', 'lunch', 'dinner'] },
        baseIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient', default: null },
        proteinIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient', default: null },
        fiberIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient', default: null },
        preferredDeliveryTime: { type: String, default: "13:00" }
    }],

    // LOGISTICS & ROUTING
    collectionType: { type: String, enum: ['Home Delivery', 'Self Pickup'], default: 'Home Delivery' },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: 'KitchenOutlet', default: null },
    
    address: {
        name: String,
        phone: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        pincode: String,
        addressType: { type: String, default: 'Home' }
    },

    // 🍴 NON-FOOD ADD-ONS (Spoons, Bowls, Containers)
    addons: [{
        addonId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'FoodAddon', 
            required: true 
        },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 }
    }],

    // 🧾 UNIFIED BILL SUMMARY (Single Consolidated Definition)
    billSummary: {
        itemTotal: { type: Number, required: true, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        packagingCharge: { type: Number, default: 15 },
        rapidCharge: { type: Number, default: 0 },
        fastDeliveryCharge: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        taxPercentage: { type: Number, default: 5 },
        
        // Logistics Pricing Breakdown Keys
        fixedPrice: { type: Number, default: 40 },
        fixedDistance: { type: Number, default: 5 },
        pricePerKM: { type: Number, default: 10 },
        freeDeliveryThreshold: { type: Number, default: 500 },
        isRapidAvailable: { type: Boolean, default: true },

        couponDiscount: { type: Number, default: 0 },
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
        totalAmount: { type: Number, required: true, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },

    // LIFECYCLE STATE MACHINE
    status: {
        type: String,
        enum: ['New', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled', 'No-Show', 'Active', 'Expired'],
        default: 'New'
    },

    paymentMethod: { type: String, enum: ['UPI', 'COD', 'Card', 'Netbanking', 'Wallet', 'Online'], default: 'COD' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], default: 'Pending' },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    deliveryOTP: { type: String, default: null },

    // Clinical Warnings Flags
    clinicalFlags: {
        elevatedCarbRisk: { type: Boolean, default: false }
    },

    // Live Trip Tracking Timestamps
    startedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },

    paymentDetails: {
        razorpayPaymentId: { type: String, default: "" },
        razorpayOrderId: { type: String, default: "" },
        razorpaySignature: { type: String, default: "" },
        paidAt: { type: Date, default: null }
    }
    
}, { timestamps: true });

// Useful Database Indexes
foodBookingSchema.index({ foodId: 1, status: 1 });
foodBookingSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('FoodBooking', foodBookingSchema);