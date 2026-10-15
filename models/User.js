// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Figma: "User" field
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { 
        type: String, 
        default: null, 
        select: false 
    },
    // NEW FLAG: Track whether user has set their own password
    isPasswordSet: { 
        type: Boolean, 
        default: false 
    },

    // FIX: Default true rahega (Normal users ke liye)
    isPasswordAvailable: { 
        type: Boolean, 
        default: false 
    },
    isUserRegistered: { 
        type: Boolean, 
        default: false 
    },

    // =========================================================================
    // 🌟 PROFILE COMPLETION & ONBOARDING FLAGS (Login check ke liye)
    // =========================================================================
    isProfileCompleted: {
        type: Boolean,
        default: false,
        index: true
    },
    profileCompletionPercentage: {
        type: Number,
        default: 25 // Registration ke baad 25%, medical onboarding ke baad 100%
    },
    onboardingStep: {
        type: Number,
        default: 1 // Step 1: Basic Register -> Step 2: Diabetes Info -> Step 3: Complete
    },

    profilePic: { type: String, default: null },

    // --- New Fields from Figma ---
    countryCode: { type: String }, // +91, +1, etc.

    fatherName: { type: String },
    weight: { type: String }, // e.g., "61 kg"
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    dob: { type: Date },      // Date of Birth
    height: { type: String }, // e.g., "5'9"

    country: { type: String }, // ID or Name store kar sakte hain
    state: { type: String },
    city: { type: String },

    workDetails: {
        companyName: { type: String },
        address: { type: String },
        city: { type: String },
        state: { type: String },
        pincode: { type: String },
        mobileNumber: { type: String }
    },

    // --- Medical Details: Family History (Figma Screen: Family History) ---
    // Options: 'None', 'Either Parent', 'Both parents'
    familyHistory: {
        diabetes: { 
            type: String, 
            enum: ['None', 'Either Parent', 'Both parents'], 
            default: 'None' 
        },
        highCholesterol: { 
            type: String, 
            enum: ['None', 'Either Parent', 'Both parents'], 
            default: 'None' 
        },
        hypertension: { 
            type: String, 
            enum: ['None', 'Either Parent', 'Both parents'], 
            default: 'None' 
        },
        obesity: { 
            type: String, 
            enum: ['None', 'Either Parent', 'Both parents'], 
            default: 'None' 
        }
    },

    // --- Medical Details: Conditions & Allergies (Figma Screen: Conditions & Allergies) ---
    conditionStatus: {
        asthma: { type: Boolean, default: false },
        diabetes: { type: Boolean, default: false },
        heartDisease: { type: Boolean, default: false },
        hypertension: { type: Boolean, default: false },
        addedConditions: [{ type: String }], 
        addedAllergies: [{ type: String }]
    },

    // --- Health Insurance Details (Figma Screen: Health Insurance Edit/Add) ---
    insuranceDetails: {
        hasInsurance: { type: Boolean, default: false },
        insuranceNumber: { type: String },
        companyName: { type: String }, // First Dropdown: "HDFC", "LICC" or "other"
        insuranceType: { type: String }, // Used when companyName is "other" (e.g., "Cashless")
        startDate: { type: String },
        endDate: { type: String },
        insuranceDocument: { type: String }, // URL of the uploaded policy file (PDF/Image)
        // Reference to specific master plan (Dropdown 2 when not "other")
        masterInsuranceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Insurance', default: null }
    },

    userAddress: [{
        name: String,
        addressType: { type: String, enum: ['Home', 'Work', 'Other'], default: 'Home' },
        phone: String,
        pincode: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        isDefault: { type: Boolean, default: false }
    }],

    familyMember: [{
        memberName: { type: String },
        relation: { type: String }, 
        dob: { type: String },
        phone: { type: String },
        gender: { type: String },
        height: { type: String },
        weight: { type: String },
        insuranceNo: { type: String },
        insuranceId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Insurance'
        },
        profilePic: { type: String, default: null },
        hasInsurance: { type: Boolean, default: false }
    }],

    emergencyContact: [{
        contactName: String,
        phone: String,
        relation: String // Friend, Brother, etc.
    }],

    insuranceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Insurance',
        default: null
    },
    abhaDetails: {
        abhaNumber: { type: String }, // 14 digits
        abhaAddress: { type: String }, // user@abdm
        txnId: { type: String }, // Tracking ID for OTP steps
        isAbhaVerified: { type: Boolean, default: false },
        consent: { type: Boolean, default: false } // Checkbox from UI
    },

    role: { type: String, default: 'user' },
    profileStatus: { type: String, default: 'Approved' },

    healthLockerPin: { type: String, select: false }, // 4-6 Digit PIN
    referralCode: { type: String, unique: true, sparse: true },
    resetPasswordOtp: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    token: {
        type: String,
        default: null
    },
    fcmToken: { type: String, default: null },

    // =========================================================================
    // 🩸 NEW ADDON FIELDS (Diabeteswala Onboarding & Old Schema Integration)
    // =========================================================================
    
     diabeticType: {
        type: String,
        default: "",
        trim: true
        
    },

    // 2. Since how long (Day, Month, Year)
    sinceHowLong: {
        day: { type: String, default: '' },      // e.g., "01"
        month: { type: String, default: '' },    // e.g., "Jan"
        year: { type: String, default: '' },     // e.g., "2000"
        formatted: { type: String, default: '' } // e.g., "01 Jan 2000"
    },
    diabeticduration: { type: String, default: '' }, // Purane schema ka alias

    // 3. Family History of Diabetes (Radio Yes/No + Checkboxes)
    hasFamilyHistoryDiabetes: {
        type: Boolean,
        default: false
    },
    familyHistoryDiabetesMembers: [{
        type: String // ['Mother', 'Father', 'Grandfather', 'Grandmother', 'Other']
    }],
    familyHistoryDiabetesOther: {
        type: String,
        default: '' // Text box for "Other: Type your own"
    },
    familyhistorydiabetic: [{ type: String }], // Purane schema ka alias

    // 4. Caregiver Details
    hasCaregiver: {
        type: Boolean,
        default: false
    },
    caregiverDetails: {
        name: { type: String, default: '' },
        relationship: { type: String, default: '' },
        phone: { type: String, default: '' },
        diabeticType: { type: String, default: '' }
    },
    caregiversname: { type: String, default: '' },     // Old schema compatibility
    relationship: { type: String, default: '' },       // Old schema compatibility
    caregiversnumber: { type: String, default: '' },   // Old schema compatibility
    caregiversdibtype: { type: String, default: '' },   // Old schema compatibility

    // 5. Partner Code
    partnerCode: {
        type: String,
        default: '',
        trim: true
    },

    // 6. Extra Lifestyle & Clinical Keys (From Old Schema)
    occupation: { type: String, default: '' },
    dailyactivity: { type: String, default: '' },
    bloodgroup: { type: String, default: '' },
    takingmedicines: { type: String, default: '' },
    otherMedicalCondition: [{ type: String }],
    age: { type: String, default: '' },
    birthyear: { type: String, default: '' },
    latitude: { type: String, default: '' },
    longitude: { type: String, default: '' },
    banner: { type: String, default: '' },
    chatStatus: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

