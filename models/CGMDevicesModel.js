// models/CGMDevicesModel.js
const mongoose = require('mongoose');

const cgmDeviceSchema = new mongoose.Schema({
    // ==========================================
    // 1. COMMON PRODUCT INFORMATION (Dono ke liye)
    // ==========================================
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'DeviceCategory', 
        required: [true, "Category selection is required"],
        index: true
    },
    productType: {
        type: String,
        enum: ['Glucometer', 'CGM'],
        required: [true, "Product type is required (Glucometer or CGM)"],
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
        default: "DiabetesWala", 
        trim: true 
    },
    deviceModel: { 
        type: String, 
        default: "Curv" 
    }, // 'Curv', 'Smart', 'CGM Sensor', 'Combo Kit'
    tagline: { 
        type: String, 
        default: "CDSCO Approved Lab-Grade Accuracy | ISO Certified | Lifetime warranty" 
    },
    badge: { 
        type: String, 
        default: "" 
    }, // 'AI-Powered', 'DEAL OF THE DAY', 'NEW LAUNCH', 'FLASH DEAL'

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

    // Base / Standalone Pricing (Single price items ke liye ya default card display ke liye)
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
    savingsAmount: { 
        type: Number, 
        default: 0 
    }, // Auto calculate: mrp - sellingPrice

    // =========================================================================
    // 2. GLUCOMETER SPECIFIC SECTION (Sirf Glucometer mein aayega)
    // =========================================================================
    glucometerConfig: {
        compatibility: {
            type: String,
            enum: ['Android Only', 'Android & iOS', 'iOS Only', 'Universal / Not Applicable', 'N/A'],
            default: 'Android Only'
        },
        connectorType: {
            type: String,
            enum: ['Type-C', 'Micro-USB', 'Lightning (iPhone)', '3.5mm Audio Jack', 'Bluetooth / Wireless', 'None'],
            default: 'Type-C'
        },
        
        // Strips & Lancets Variants (25 Strips, 50 Strips, 100 Strips with different prices)
        stripLancetVariants: [{
            variantName: { type: String, required: true }, // e.g. "25 Strips & 25 Lancets", "50 Strips & 50 Lancets"
            stripsCount: { type: Number, default: 25 },
            lancetsCount: { type: Number, default: 25 },
            compatibility: { type: String, default: 'Android Only' }, // 'Android Only' or 'Android & iOS'
            mrp: { type: Number, required: true },
            sellingPrice: { type: Number, required: true },
            savingsAmount: { type: Number, default: 0 },
            stockQuantity: { type: Number, default: 100 },
            isDefault: { type: Boolean, default: false }
        }],

        // Glucometer Clinical Specs
        specifications: {
            coefficientOfVariation: { type: String, default: "CV < 2%" },
            accuracyTesting: { type: String, default: "NIB Tested & CDSCO Approved" },
            certifications: [{ type: String }], // ["ISO 15197:2013", "CDSCO Approved", "CE Certified"]
            bloodSampleSize: { type: String, default: "0.5 µL" },
            testDurationSeconds: { type: Number, default: 5 },
            measuringRange: { type: String, default: "20 - 600 mg/dL" },
            batteryRequired: { type: Boolean, default: false },
            autoSaveReadings: { type: Boolean, default: true },
            hba1cEstimationCapable: { type: Boolean, default: true },
            warranty: { type: String, default: "Lifetime Warranty" }
        }
    },

    // =========================================================================
    // 3. CGM SENSOR SPECIFIC SECTION (Sirf CGM mein aayega)
    // =========================================================================
    cgmConfig: {
        sensorLifeSpanDays: { type: Number, default: 14 },     // 14 or 15 Days
        sensorWarmupTime: { type: String, default: "60 mins" },
        waterResistance: { type: String, default: "IP28 Water Resistant" },
        appSyncSupported: { type: Boolean, default: true },    // Live Bluetooth continuous tracking
        isCoachSupportIncluded: { type: Boolean, default: false },
        coachSupportDuration: { type: String, default: "1 Month Free Coaching" },

        // CGM Packages (Pack of 1, 2, 4, 6, 8, 10, CGM + Coach with different prices & badges)
        cgmPacks: [{
            packName: { type: String, required: true }, // e.g. "Pack of 1", "Pack of 4", "CGM + Coach Support"
            sensorsCount: { type: Number, default: 1 }, // 1, 2, 4, 6, 8, 10 sensors
            savingsBadge: { type: String, default: "" }, // e.g. "Save ₹497", "Save ₹795", "Save ₹3,490"
            mrp: { type: Number, required: true },
            sellingPrice: { type: Number, required: true },
            savingsAmount: { type: Number, default: 0 },
            stockQuantity: { type: Number, default: 50 },
            isDefault: { type: Boolean, default: false }
        }]
    },

    // ==========================================
    // 4. COMMON ACCORDIONS & SECTIONS (Dono ke liye)
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

    // Frequently Bought Together (Cross-selling e.g. Karela juice, glucometer with CGM)
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