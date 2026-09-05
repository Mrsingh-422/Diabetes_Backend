// models/Ambulance.js
const mongoose = require('mongoose');

const ambulanceSchema = new mongoose.Schema({
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
    name: { type: String, required: true }, // Vehicle / Driver Display Name
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { 
        type: String, 
        enum: ['clinic-ambulance', 'ambulance', ], 
        default: 'clinic-ambulance'
    },

    country: { type: String, default: 'India' },
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
        enum: ['Van', 'Mini Van', 'Advance Life Support', 'ICU Ambulance'], 
        default: 'Van' 
    },

    // Vehicle Information
    vehicleNumber: { type: String, default: null },
    rcNumber: { type: String, default: null },
    insuranceNumber: { type: String, default: null },

    // Documents
    documents: {
        drivingLicenseFile: { type: String, default: null },
        rcFile: { type: String, default: null },
        insuranceFile: { type: String, default: null },
        fitnessCertificate: { type: String, default: null },
        ambulancePermit: { type: String, default: null }
    },

    serviceRadius: { type: String, default: '15 km' }, 
    availableForEmergency: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },

    // 🚀 Clinic Private Ride & Fixed Pricing Structure
    pricing: {
        singleRidePrice: { type: Number, default: 400 }, // One-way fixed rate
        doubleRidePrice: { type: Number, default: 700 }, // Round-trip package rate
        baseDistance: { type: Number, default: 5 },     // Base KM
        pricePerKM: { type: Number, default: 12 }        // Extra per KM charge
    },

    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    isPhoneVerified: { type: Boolean, default: false },
    token: { type: String, default: null },
    fcmToken: { type: String, default: null },
    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Approved' 
    },
    rejectionReason: { type: String, default: null },
    bankDetails: {
        accountType: { type: String, enum: ['Savings', 'Current'], default: 'Savings' },
        bankName: { type: String, default: "" },
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        upiId: { type: String, default: "" },
        isVerified: { type: Boolean, default: false }
    }

}, { timestamps: true });

module.exports = mongoose.model('Ambulance', ambulanceSchema);