const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true, lowercase: true },
    countryCode: { type: String, default: null },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['doctor', 'clinic-doctor'], default: 'doctor' },

    // Location & Personal Details
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' }, //  UI Form Sync
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    pincode: { type: String, default: null }, //  UI Form Sync
    address: { type: String, default: null },

    dutyStatus: { type: String, enum: ['On Duty', 'Off Duty', 'On Leave', 'Busy'], default: 'Off Duty' },
    isPhoneVerified: { type: Boolean, default: false },
    resetOTP: { type: String, default: null },
    token: { type: String, default: null },
    fcmToken: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },
    alternatePhone: { type: String, default: null },

    // Professional Info
    qualification: { type: String, default: null }, // Primary degree summary string (e.g., "MBBS, MD")
    
    //  UI Form Dynamic Multiple Degrees Array Sync
    // Educational Qualifications with Council Details
    qualifications: [{
        degree: { type: String },
        college: { type: String },
        year: { type: String },
        certFile: { type: String, default: null },
        councilName: { type: String, default: "" },    // 👈 Medical Council Name
        registrationNo: { type: String, default: "" }, // 👈 Registration No
        stateName: { type: String, default: "" }       // 👈 State Name
    }],

    speciality: { type: String, default: null },
    licenseNumber: { type: String, default: null },
    councilNumber: { type: String, default: null },
    councilName: { type: String, default: null },
    about: { type: String, default: null },
    experienceYears: { type: Number, default: 0 },
    languages: [{ type: String }],

    fees: {
        online: { type: Number, default: 0 },
        clinic: { type: Number, default: 0 },
        home: { type: Number, default: 0 }
    },
    consultationStatus: {
        online: { type: Boolean, default: true },
        clinic: { type: Boolean, default: true },
        home: { type: Boolean, default: true }
    },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },

    slotDuration: { type: Number, default: 30 },
    availability: [{
        day: { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
        startTime: String,
        endTime: String,
        isLiveTrackingAvailable: { type: Boolean, default: false }
    }],
    treatedConditions: [{ type: String }],
    competencies: [{ type: String }],

    // Stats & Media
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    profileImage: { type: String, default: null },
    signatureImage: { type: String, default: null },
    documents: [{ type: String }],

    profileStatus: {
        type: String,
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
        default: 'Incomplete'
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

module.exports = mongoose.model('Doctor', doctorSchema);