// models/CGMDevicesModel.js
const mongoose = require('mongoose');

const cgmDeviceSchema = new mongoose.Schema({
    // ==========================================
    // 1. COMMON PRODUCT INFORMATION (Har item ke liye)
    // ==========================================
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'DeviceCategory', 
        required: [true, "Category selection is required"],
        index: true
    },
    // Product Type frontend ko batayega ki konsa UI format dikhana hai
    productType: {
        type: String,
        enum: ['Glucometer', 'CGM', 'Supplement', 'Accessory'],
        default: 'Glucometer',
        required: true,
        index: true
    },
    title: { 
        type: String, 
        required: [true, "Product title is required"], 
        trim: true 
    },
    brand: { 
        type: String, 
        required: true, 
        default: "BeatO", 
        trim: true 
    },
    deviceModel: { 
        type: String, 
        default: "Standard" 
    }, // 'Curv', 'Smart', 'CGM Sensor', 'Ayurvedic', 'Nutrition'
    tagline: { 
        type: String, 
        default: "" 
    },
    badge: { 
        type: String, 
        default: "" 
    }, // 'AI-Powered', '100% Organic', 'Bestseller', 'Deal of the Day'

    // Media
    mainImage: { 
        type: String, 
        required: [true, "Main showcase image is required"] 
    },
    images: [{ 
        type: String, 
        default: [] 
    }],
    demoVideoUrl: { 
        type: String, 
        default: null 
    },

    // Pricing
    mrp: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    sellingPrice: { 
        type: Number, 
        required: true, 
        min: 0 
    },
    prepaidDiscountPrice: { 
        type: Number, 
        default: 0 
    },
    savingsAmount: { 
        type: Number, 
        default: 0 
    },

    // ==========================================
    // 2. GLUCOMETER SPECIFIC FIELDS (Sirf Glucometer ke liye)
    // ==========================================
    compatibility: {
        type: String,
        enum: ['Android Only', 'Android & iOS', 'iOS Only', 'Universal / Not Applicable'],
        default: 'Universal / Not Applicable'
    },
    connectorType: {
        type: String,
        enum: ['Type-C', 'Micro-USB', 'Lightning (iPhone)', '3.5mm Audio Jack', 'Bluetooth / Wireless', 'None'],
        default: 'None'
    },

    // ==========================================
    // 3. GENERIC VARIANTS (Glucometer, CGM & Supplement sabhi ke liye)
    // ==========================================
    variants: [{
        variantName: { type: String, required: true }, // e.g. "25 Strips & 25 Lancets" OR "60 Veg Capsules" OR "Pack of 2"
        packSize: { type: String, default: "" },       // e.g. "60 Capsules", "100g", "1 Unit"
        stripsCount: { type: Number, default: 0 },
        lancetsCount: { type: Number, default: 0 },
        compatibility: { type: String, default: 'Universal / Not Applicable' },
        mrp: { type: Number, required: true },
        sellingPrice: { type: Number, required: true },
        stockQuantity: { type: Number, default: 100 },
        isDefault: { type: Boolean, default: false }
    }],

    // ==========================================
    // 4. CATEGORY SPECIFIC SPECIFICATIONS
    // ==========================================
    
    // A. Technical / Device Specs (For Glucometers & Hardware)
    specifications: {
        coefficientOfVariation: { type: String, default: "" }, // "CV < 2%"
        accuracyTesting: { type: String, default: "" },        // "NIB Tested & CDSCO Approved"
        certifications: [{ type: String }],
        bloodSampleSize: { type: String, default: "" },        // "0.5 µL"
        testDurationSeconds: { type: Number, default: 5 },
        measuringRange: { type: String, default: "" },
        batteryRequired: { type: Boolean, default: false },
        autoSaveReadings: { type: Boolean, default: true },
        hba1cEstimationCapable: { type: Boolean, default: false },
        warranty: { type: String, default: "" }
    },

    // B. CGM Sensor Specifics (For Continuous Monitoring)
    cgmDetails: {
        sensorLifeSpanDays: { type: Number, default: 14 },     // 14 or 15 days
        sensorWarmupTime: { type: String, default: "60 mins" },
        waterResistance: { type: String, default: "IP28 Water Resistant" },
        isDoctorConsultationIncluded: { type: Boolean, default: false },
        consultationTitle: { type: String, default: "Free Weight & Diabetes Coach Consultation" }
    },

    // C. Supplement Specifics (For Moringa, Cinnamon, Shilajit, Juices, Tumblers)
    supplementDetails: {
        form: { 
            type: String, 
            enum: ['Capsules', 'Powder', 'Liquid / Juice', 'Tablet', 'Resin', 'Herbal Wood / Tumbler', 'N/A'],
            default: 'N/A'
        },
        dietaryPreference: { 
            type: String, 
            enum: ['100% Vegetarian', 'Vegan', 'Organic', 'Sugar-Free', 'N/A'],
            default: '100% Vegetarian'
        },
        dosage: { type: String, default: "" },              // e.g. "2 capsules twice daily with water"
        netQuantity: { type: String, default: "" },         // e.g. "60 Capsules" or "100 grams"
        keyIngredients: [{ type: String }],                // e.g. ["Organic Moringa Leaf Powder", "Cinnamon Extract"]
        shelfLife: { type: String, default: "24 Months" },  // e.g. "24 Months from MFG"
        ayushCertified: { type: Boolean, default: true }
    },

    // ==========================================
    // 5. COMMON ACCORDIONS & UI SECTIONS
    // ==========================================
    highlights: [{
        icon: { type: String, default: "" },
        title: { type: String, required: true },
        description: { type: String, default: "" }
    }],

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
    }],
    faqs: [{
        question: { type: String, required: true },
        answer: { type: String, required: true }
    }],

    // Frequently Bought Together Cross-Selling (As seen in Screenshot)
    frequentlyBoughtTogether: [{
        productId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'CGMDevices' 
        },
        customPrice: { type: Number, default: 0 }
    }],

    // Inventory & Status
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
    }
}, { timestamps: true });

cgmDeviceSchema.index({ title: 'text', brand: 'text', productType: 'text' });

module.exports = mongoose.model('CGMDevices', cgmDeviceSchema);