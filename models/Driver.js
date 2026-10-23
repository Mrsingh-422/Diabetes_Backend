const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
    // Dynamic Reference to Vendor (Pharmacy, Lab, Food)
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorType',
        index: true 
    },
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Food'], 
        required: true 
    },

    name: { 
        type: String, 
        required: true,
        trim: true 
    },
    phone: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true 
    },
    alternateNumber: { 
        type: String, 
        default: null 
    },
    username: { 
        type: String, 
        unique: true, 
        required: true,
        trim: true 
    },
    password: { 
        type: String, 
        required: true, 
        select: false 
    },

    role: { 
        type: String, 
        default: 'driver', 
        immutable: true 
    },

    country: { type: String, default: 'India' },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },

    // 🌟 1. Live GPS Location (Customer App & Pharmacy Panel Live Tracking ke liye)
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    profilePic: { 
        type: String, 
        default: null 
    },
    
    // 🌟 2. Documents with Safe Default Nulls
    documents: {
        certificate: { type: String, default: null },
        license: { type: String, default: null },
        rcImage: { type: String, default: null }
    },

    vehicleNumber: { type: String, default: null },
    vehicleType: { type: String, default: 'Bike' }, // Bike, Scooter, Van
    aadhaarNumber: { type: String, default: null },
    
    status: { 
        type: String, 
        enum: ['Available', 'Busy', 'Offline'], 
        default: 'Available',
        index: true 
    },

    // 🌟 3. FCM Token for Firebase Push Notifications
    fcmToken: { 
        type: String, 
        default: null 
    },
    token: { 
        type: String, 
        default: null 
    },

    isActive: { 
        type: Boolean, 
        default: true 
    },
    isOnline: { 
        type: Boolean, 
        default: true 
    }

}, { timestamps: true });

// ⚡ Fast Driver Lookup Index (Assignment aur search speed badhane ke liye)
driverSchema.index({ vendorId: 1, status: 1 });
driverSchema.index({ name: 'text', phone: 'text', username: 'text' });

module.exports = mongoose.model('Driver', driverSchema);