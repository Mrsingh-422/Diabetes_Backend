// models/GlucoseDevice.js
const mongoose = require('mongoose');

const glucoseDeviceSchema = new mongoose.Schema({
    // ==========================================
    // 1. BASIC PRODUCT INFORMATION
    // ==========================================
    title: { 
        type: String, 
        required: [true, "Device title is required"], 
        trim: true 
    }, // e.g. "New BeatO AI-Powered Glucometer | Auto Saves Readings"
    brand: { 
        type: String, 
        required: true, 
        default: "DiabetecWala", 
        trim: true 
    },
    deviceModel: { 
        type: String, 
        enum: ['Curv', 'Smart', 'CGM Sensor', 'Traditional'], 
        default: 'Curv' 
    },
    deviceCategory: {
        type: String,
        enum: ['CGM Device', 'Smartphone Glucometer', 'Standard Glucometer', 'Test Strips & Lancets'],
        default: 'Smartphone Glucometer'
    },
    tagline: { 
        type: String, 
        default: "CDSCO Approved Lab-Grade Accuracy | ISO Certified | Lifetime Warranty" 
    },
    badge: { 
        type: String, 
        default: "AI-Powered" 
    }, // e.g. "AI-Powered", "Bestseller", "Clinically Proven"

    // ==========================================
    // 2. MEDIA & GALLERY
    // ==========================================
    mainImage: { 
        type: String, 
        required: true 
    },
    images: [{ 
        type: String, 
        required: true 
    }], // Multiple showcase images
    demoVideoUrl: { 
        type: String, 
        default: null 
    },

    // ==========================================
    // 3. PRICING & DISCOUNTS (Base / Default)
    // ==========================================
    mrp: { 
        type: Number, 
        required: true, 
        min: 0 
    }, // e.g. 1047
    sellingPrice: { 
        type: Number, 
        required: true, 
        min: 0 
    }, // e.g. 499
    prepaidDiscountPrice: { 
        type: Number, 
        default: 0 
    }, // e.g. 474 (Prepaid special price)
    savingsAmount: { 
        type: Number, 
        default: 0 
    }, // e.g. 548

    // ==========================================
    // 4. COMPATIBILITY & HARDWARE PORTS (From UI)
    // ==========================================
    compatibility: {
        type: String,
        enum: ['Android Only', 'Android & iOS', 'iOS Only'],
        default: 'Android Only'
    },
    connectorType: {
        type: String,
        enum: ['Type-C', 'Micro-USB', 'Lightning (iPhone)', '3.5mm Audio Jack', 'Bluetooth / Wireless', 'NFC'],
        default: 'Type-C'
    },

    // ==========================================
    // 5. STRIP & LANCET BUNDLE VARIANTS (Dropdown Options)
    // ==========================================
    variants: [{
        variantName: { type: String, required: true }, // e.g., "25 Strips & 25 Lancets", "50 Strips & 50 Lancets", "100 Strips"
        stripsCount: { type: Number, default: 25 },
        lancetsCount: { type: Number, default: 25 },
        compatibility: { 
            type: String, 
            enum: ['Android Only', 'Android & iOS'], 
            default: 'Android Only' 
        },
        mrp: { type: Number, required: true },
        sellingPrice: { type: Number, required: true },
        stockQuantity: { type: Number, default: 100 },
        isDefault: { type: Boolean, default: false }
    }],

    // ==========================================
    // 6. CLINICAL & TECHNICAL SPECIFICATIONS
    // ==========================================
    specifications: {
        coefficientOfVariation: { type: String, default: "CV < 2%" }, // High precision benchmark
        accuracyTesting: { type: String, default: "NIB Tested & CDSCO Approved" }, // National Institute of Biologicals
        certifications: [{ type: String }], // e.g. ["ISO 15197:2013", "CDSCO", "CE", "GMP"]
        bloodSampleSize: { type: String, default: "0.5 µL" }, // Tiny blood droplet requirement
        testDurationSeconds: { type: Number, default: 5 }, // 5 seconds fast result
        measuringRange: { type: String, default: "20 - 600 mg/dL" },
        sensorWarmupTime: { type: String, default: "60 mins" }, // For CGM Continuous monitoring
        sensorLifeSpanDays: { type: Number, default: 14 },     // For CGM patches (e.g. 14 days continuous)
        batteryRequired: { type: Boolean, default: false },    // Battery-free smartphone plug-in
        autoSaveReadings: { type: Boolean, default: true },
        hba1cEstimationCapable: { type: Boolean, default: true }, // Estimated HbA1c generation
        warranty: { type: String, default: "Lifetime Warranty" }
    },

    // ==========================================
    // 7. KEY HIGHLIGHTS & BENEFIT BADGES (UI Bullets)
    // ==========================================
    highlights: [{
        icon: { type: String, default: "" }, // Icon URL or identifier
        title: { type: String, required: true }, // e.g. "Lab-Grade Accuracy", "Auto-Saves Readings"
        description: { type: String, default: "" }
    }],

    // ==========================================
    // 8. PRODUCT DETAILS, HOW-TO-USE & ACCORDIONS
    // ==========================================
    description: { 
        type: String, 
        required: true 
    },
    howToUseSteps: [{
        stepNumber: Number,
        title: String,
        instruction: String,
        stepImage: String
    }],
    boxContents: [{ 
        type: String 
    }], // e.g. ["1 BeatO Curv Glucometer", "25 Strips", "25 Lancets", "1 Lancing Pen", "Travel Pouch"]

    // FAQs Accordion (From Screenshot)
    faqs: [{
        question: { type: String, required: true },
        answer: { type: String, required: true }
    }],

    // ==========================================
    // 9. DIABETES HEALTH PLATFORM INTEGRATION
    // ==========================================
    // Automatic sync with user's diabetes journal (HealthData.js)
    isAppSyncSupported: { 
        type: Boolean, 
        default: true 
    },
    // Bonus benefit (e.g. 1 Free Doctor / Diabetes Educator consultation on purchase)
    freeConsultationIncluded: {
        isIncluded: { type: Boolean, default: true },
        consultationType: { type: String, default: "Diabetes Care Expert" }
    },

    // "Frequently Bought Together" linked items (e.g., Karela Jamun Juice, Diabetic Snacks)
    frequentlyBoughtTogether: [{
        productType: {
            type: String,
            enum: ['FoodService', 'smoothiDrinks', 'Medicine', 'GlucoseDevice'],
            default: 'FoodService'
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'frequentlyBoughtTogether.productType'
        }
    }],

    // ==========================================
    // 10. INVENTORY & STATUS
    // ==========================================
    stockQuantity: { 
        type: Number, 
        default: 100, 
        min: 0 
    },
    isAvailable: { 
        type: Boolean, 
        default: true 
    },
    isFeatured: { 
        type: Boolean, 
        default: false 
    },
    isPopular: { 
        type: Boolean, 
        default: false 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },

    // Ratings & Reviews counter
    averageRating: { 
        type: Number, 
        default: 4.8 
    },
    totalReviews: { 
        type: Number, 
        default: 0 
    },
    totalUsersCountDisplay: { 
        type: String, 
        default: "8 Lakh+ Users" 
    } // "Trusted by 8 Lakh+ Users" section from screenshot

}, { timestamps: true });

// Text indexing for fast search by device name, model and brand
glucoseDeviceSchema.index({ title: 'text', brand: 'text', deviceModel: 'text' });

module.exports = mongoose.model('CGMDevices', glucoseDeviceSchema);