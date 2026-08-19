const mongoose = require('mongoose');

const foodBookingSchema = new mongoose.Schema({
    // Standard ID Format: ORD-XXXXXXXX / FD-XXXXXXXX
    bookingId: { type: String, unique: true, required: true }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Food', required: true }, // Kitchen/Brand ID

    bookingType: { 
        type: String, 
        enum: ['Direct', 'Subscription', 'Custom Plate'], 
        default: 'Direct' 
    },

    // A. AGGREGATOR TILES: Direct Orders or Tiffin items
    items: [{
        productType: { type: String, enum: ['MealItem', 'Combo'], required: true, default: 'MealItem' },
        itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        mealType: { type: String, enum: ['Single Meal', 'Weekly Subscription', 'Monthly Subscription'] },
        isComboApplied: { type: Boolean, default: false },
        comboOfferId: { type: mongoose.Schema.Types.ObjectId, default: null }
    }],

    // B. TIFFIN SUBSCRIBERS: Setup for regular dynamic meal deliveries (OurTiffin flow)
    subscriptionDetails: {
        planId: { type: String }, // E.g., "two-meals", "one-meal"
        billingCycle: { type: String, enum: ['weekly', 'monthly'] },
        startDate: { type: Date },
        endDate: { type: Date },
        slotsConfiguration: [{
            slotName: { type: String, enum: ['breakfast', 'lunch', 'dinner'] },
            mealId: { type: mongoose.Schema.Types.ObjectId }, // References standard MealItem
            preferredTime: { type: String } // E.g., "13:00"
        }]
    },

    // C. CUSTOM PLATE WORKSPACE: If user assembled custom tiffins
    customPlateSchedule: [{
        dayOfWeek: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
        slotName: { type: String, enum: ['breakfast', 'lunch', 'dinner'] },
        baseIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient' },
        proteinIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient' },
        fiberIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomBuilderIngredient' },
        preferredDeliveryTime: { type: String } // E.g., "20:00"
    }],

    // LOGISTICS & ROUTING
    collectionType: { type: String, enum: ['Home Delivery', 'Self Pickup'], default: 'Home Delivery' },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: 'KitchenOutlet', default: null }, // Nearest selected kitchen hub
    
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

    // BILL SUMMARY
    billSummary: {
        itemTotal: { type: Number, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        couponDiscount: { type: Number, default: 0 },
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
        totalAmount: { type: Number, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },

    // LIFECYCLE STATE MACHINE (Standard sequence as per your specs)
    status: {
        type: String,
        enum: ['New', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled', 'No-Show'],
        default: 'New'
    },

    paymentMethod: { type: String, enum: ['UPI', 'COD', 'Card', 'Netbanking', 'Wallet', 'Online'], default: 'COD' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], default: 'Pending' },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null }, // Assigned Food Driver
    deliveryOTP: { type: String, default: null },

    // Clinical Warnings Flags (e.g. Assembled Carb Risk)
    clinicalFlags: {
        elevatedCarbRisk: { type: Boolean, default: false } // True if daily carbs configured > 70g
    },

    // Live trip tracking timestamps
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

module.exports = mongoose.model('FoodBooking', foodBookingSchema);