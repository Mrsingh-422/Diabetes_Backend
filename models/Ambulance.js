// models/Ambulance.js
const mongoose = require('mongoose');

const ambulanceSchema = new mongoose.Schema({
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true }, // 🚀 Strictly Clinic-Owned
    name: { type: String, required: true }, // Vehicle / Driver Display Name
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { 
        type: String, 
        enum: ['clinic-ambulance'], 
        default: 'clinic-ambulance',
        immutable: true 
    },

    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },

    // Driver details
    drivingLicenseNumber: { type: String, default: null },
    licenseExpiryDate: { type: Date, default: null },
    experienceYears: { type: String, default: null },
    bloodGroup: { type: String, default: null },
    vehicleType: { 
        type: String, 
        enum: ['Van', 'Mini Van', 'Advance Life Support'], 
        default: 'Van' 
    },

    vehicleNumber: { type: String, default: null },
    rcNumber: { type: String, default: null },
    insuranceNumber: { type: String, default: null },

    documents: {
        drivingLicenseFile: { type: String, default: null },
        rcFile: { type: String, default: null },
        insuranceFile: { type: String, default: null }
    },

    serviceRadius: { type: String, default: '15 km' }, 
    availableForEmergency: { type: Boolean, default: true },

    // 🚀 NEW: Clinic Private Ride Pricing Structure
    pricing: {
        singleRidePrice: { type: Number, default: 400 }, // Ghar se clinic aane ka fixed charge
        doubleRidePrice: { type: Number, default: 700 }, // Round trip packages rate
        baseDistance: { type: Number, default: 5 },     // Base covered KM
        pricePerKM: { type: Number, default: 12 }        // Extra charges beyond base distance
    },

    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    isPhoneVerified: { type: Boolean, default: false },
    token: { type: String, default: null },
    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String, default: null }

}, { timestamps: true });

module.exports = mongoose.model('Ambulance', ambulanceSchema);