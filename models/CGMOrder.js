// models/CGMOrder.js
const mongoose = require('mongoose');

const cgmOrderSchema = new mongoose.Schema({
    orderId: { 
        type: String, 
        unique: true, 
        required: true 
    }, // e.g. "HK-CGM-102934"
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },

    // 1. Device / Product Info
    device: {
        deviceId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'CGMDevices', 
            required: true 
        },
        productType: { 
            type: String, 
            enum: ['Glucometer', 'CGM'], 
            required: true 
        },
        title: { type: String, required: true },
        brand: { type: String, default: "DiabetesWala" },
        mainImage: { type: String, required: true },
        deviceModel: { type: String, default: "Curv" },
        selectedVariant: {
            variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
            variantName: { type: String, default: "" }, // e.g. "Pack of 4" or "25 Strips & 25 Lancets"
            mrp: { type: Number, default: 0 },
            sellingPrice: { type: Number, default: 0 },
            savingsBadge: { type: String, default: "" }
        },
        unitPrice: { type: Number, required: true },
        unitMrp: { type: Number, required: true },
        quantity: { type: Number, default: 1, min: 1 }
    },

    // 2. Patient Diabetic Profile (Checkout form fields)
    diabetesProfile: {
        diabetesType: {
            type: String,
            enum: ['Type 1', 'Type 2', 'Pre-diabetic', 'Gestational', 'General Wellness', 'Not Sure'],
            default: 'Type 2'
        },
        hasUsedBefore: { 
            type: Boolean, 
            default: false 
        } // User previously used this device or not
    },

    // 3. User Delivery Address
    deliveryAddress: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        houseNo: { type: String, default: "" },
        sector: { type: String, default: "" },
        landmark: { type: String, default: "" },
        city: { type: String, required: true },
        state: { type: String, required: true },
        pincode: { type: String, required: true },
        addressType: { type: String, default: 'Home' }
    },

    // 4. Selected CGM Addons (Protective patches, lancets, swabs, etc.)
    addons: [{
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: 'CGMAddon', required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1, min: 1 },
        totalPrice: { type: Number, required: true }
    }],

    // 5. Coach Charge / Consultation (Optional Selection)
    coachConsultation: {
        isIncluded: { type: Boolean, default: false },
        coachChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CGMAddon', default: null },
        charge: { type: Number, default: 0 },
        description: { type: String, default: "" }
    },

    // 6. Billing Summary
    billSummary: {
        itemTotal: { type: Number, required: true, default: 0 },
        mrpTotal: { type: Number, required: true, default: 0 },
        deviceSavings: { type: Number, default: 0 },
        addonsTotal: { type: Number, default: 0 },
        coachChargeTotal: { type: Number, default: 0 },
        subtotal: { type: Number, required: true, default: 0 },
        couponDiscount: { type: Number, default: 0 },
        totalPayable: { type: Number, required: true, default: 0 }
    },

    // 7. Applied Coupon Details
    appliedCoupon: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
        couponCode: { type: String, default: null },
        discountApplied: { type: Number, default: 0 }
    },

    // 8. Payment & Order Status
    paymentMethod: { 
        type: String, 
        enum: ['COD', 'Online'], 
        default: 'COD' 
    },
    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'], 
        default: 'Pending' 
    },
    transactionId: { 
        type: String, 
        default: null 
    },
    status: { 
        type: String, 
        enum: ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out For Delivery', 'Delivered', 'Cancelled'], 
        default: 'Placed' 
    },
    deliveryOtp: { 
        type: String, 
        default: null 
    },

    trackingTimeline: [{
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        note: { type: String, default: "" }
    }]

}, { timestamps: true });

cgmOrderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('CGMOrder', cgmOrderSchema);