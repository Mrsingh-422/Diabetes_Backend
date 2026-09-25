// models/Lab.js
const mongoose = require('mongoose');

const labSchema = new mongoose.Schema({
    // 🏥 CLINIC ATTACHMENT FIELDS
    clinicId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Clinic', 
        default: null,
        index: true 
    },
    isClinic: { 
        type: Boolean, 
        default: false,
        index: true 
    },

    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    
    // Role updated to support both Standalone & Clinic Lab
    role: { 
        type: String, 
        enum: ['Lab', 'clinic-lab'], 
        default: 'Lab' 
    },

    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    token: { type: String, default: null },
    fcmToken: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },

    profileImage: { type: String, default: null },
    signatureImage: { type: String, default: null },

    // Location Details
    country: { type: String, default: 'India' },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    documents: {
        labImages: [{ type: String }],
        labCertificates: [{ type: String }],
        labLicenses: [{ type: String }],
        gstCertificates: [{ type: String }],
        drugLicenses: [{ type: String }],
        otherCertificates: [{ type: String }],

        documentState: { type: String },
        issuingAuthority: { type: String },
        gstNumber: { type: String },
        experience: { type: String },
        nablNumber: { type: String, default: "" },

        drugLicenseType: {
            type: String,
            enum: ['Retail', 'Wholesale', 'Restricted', 'Blood Bank', 'None'],
            default: 'None'
        }
    },

    rejectionReason: { type: String, default: null },
    alternatePhone: { type: String, default: null },

    isHomeCollectionAvailable: { type: Boolean, default: false },
    isRapidServiceAvailable: { type: Boolean, default: false },
    isInsuranceAccepted: { type: Boolean, default: false },
    acceptedInsurances: [{ type: String }],
    is24x7: { type: Boolean, default: false },
    openingTime: { 
        type: String, 
        default: "09:00 AM" 
    },
    closeTime: { 
        type: String, 
        default: "09:00 PM" 
    },
    holiday: { 
        type: String, 
        default: "Sunday" 
    },
    about: { type: String, default: "" },
    rating: { type: Number, default: 4.5 },
    totalReviews: { type: Number, default: 0 },

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

module.exports = mongoose.model('Lab', labSchema);