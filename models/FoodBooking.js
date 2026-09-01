// models/FoodBooking.js
const mongoose = require('mongoose');

const foodBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true, required: true }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Food', required: true }, // Kitchen ID

    bookingType: { 
        type: String, 
        enum: ['Direct', 'Subscription', 'Custom Plate'], 
        default: 'Direct' 
    },

    // A. DIRECT MEALS & COMBOS
    items: [{
        productType: { type: String, enum: ['MealItem', 'Combo'], required: true, default: 'MealItem' },
        itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        mealType: { type: String, default: 'Single Meal' },
        isComboApplied: { type: Boolean, default: false },
        comboOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodComboOffer', default: null }
    }],

    // B. STANDARD PRE-SET TIFFIN SUBSCRIPTION (Weekly / 4-Week Monthly)
    subscriptionDetails: {
        planId: { type: String, default: null },
        planName: { type: String, default: "Custom Tiffin Plan" },
        billingCycle: { type: String, enum: ['weekly', 'monthly', 'custom'], default: 'weekly' },
        durationDays: { type: Number, default: 7 },
        startDate: { type: Date },
        endDate: { type: Date },
        universalDeliveryTimes: {
            breakfastTime: { type: String, default: "08:00 AM - 09:00 AM" },
            lunchTime: { type: String, default: "01:00 PM - 02:00 PM" },
            dinnerTime: { type: String, default: "08:00 PM - 09:00 PM" }
        },
        dailyMealSchedule: [{
            weekNumber: { type: Number, default: 1 },
            dayOfWeek: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
            slotName: { type: String, enum: ['breakfast', 'lunch', 'dinner'] },
            mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodService' },
            mealName: { type: String },
            mealImage: { type: String },
            mealPrice: { type: Number },
            calories: { type: Number },
            dietType: { type: String },
            deliveryTime: { type: String }
        }]
    },

    // 🎨 C. 7-DAY CYCLICAL CUSTOM TIFFIN BUILDER (Monday to Sunday Custom Rotation)
    customTiffinDetails: {
        packageDays: { type: Number, default: 10 },
        startDate: { type: Date },
        endDate: { type: Date },
        dietaryType: { type: String, enum: ['veg', 'egg', 'jain'], default: 'veg' },
        spiceLevel: { type: String, enum: ['mild', 'medium', 'low-sodium'], default: 'mild' },
        clinicalNotes: { type: String, default: "" },
        
        selectedMeals: {
            breakfast: { type: Boolean, default: false },
            lunch: { type: Boolean, default: false },
            dinner: { type: Boolean, default: false }
        },
        
        universalDeliveryTimes: {
            breakfastTime: { type: String, default: "08:00 AM - 09:00 AM" },
            lunchTime: { type: String, default: "01:00 PM - 02:00 PM" },
            dinnerTime: { type: String, default: "08:00 PM - 09:00 PM" }
        },

        // 🌟 7-Day Day-Wise Custom Selection (Monday to Sunday)
        weeklyCustomSchedule: [{
            dayOfWeek: { 
                type: String, 
                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 
                required: true 
            },
            breakfast: {
                mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodService', default: null },
                mealName: { type: String, default: null },
                price: { type: Number, default: 0 },
                calories: { type: Number, default: 0 },
                deliverySlot: { type: String, default: "08:30 AM - 09:30 AM" }
            },
            lunch: {
                mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodService', default: null },
                mealName: { type: String, default: null },
                price: { type: Number, default: 0 },
                calories: { type: Number, default: 0 },
                deliverySlot: { type: String, default: "12:00 PM - 01:00 PM" }
            },
            dinner: {
                mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodService', default: null },
                mealName: { type: String, default: null },
                price: { type: Number, default: 0 },
                calories: { type: Number, default: 0 },
                deliverySlot: { type: String, default: "07:00 PM - 08:00 PM" }
            }
        }]
    },

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

    // 🍴 NON-FOOD ADD-ONS
    addons: [{
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAddon', required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 }
    }],

    // 🧾 BILL SUMMARY
    billSummary: {
        itemTotal: { type: Number, required: true, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        packagingCharge: { type: Number, default: 15 },
        rapidCharge: { type: Number, default: 0 },
        fastDeliveryCharge: { type: Number, default: 0 },
        peakOrderCharge: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        taxPercentage: { type: Number, default: 5 },
        
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

    status: {
        type: String,
        enum: ['New', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled', 'No-Show', 'Active', 'Expired'],
        default: 'New'
    },

    paymentMethod: { type: String, enum: ['UPI', 'COD', 'Card', 'Netbanking', 'Wallet', 'Online'], default: 'COD' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], default: 'Pending' },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    deliveryOTP: { type: String, default: null },

    clinicalFlags: {
        elevatedCarbRisk: { type: Boolean, default: false }
    },

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

foodBookingSchema.index({ foodId: 1, status: 1 });
foodBookingSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('FoodBooking', foodBookingSchema);