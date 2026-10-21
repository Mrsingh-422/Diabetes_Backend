// models/Pharmacy.js
const mongoose = require('mongoose');

const pharmacySchema = new mongoose.Schema({
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
    
    role: { 
        type: String, 
        enum: ['Pharmacy', 'clinic-pharmacy'], 
        default: 'Pharmacy' 
    },
    
     profileStatus: { type: String, enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], default: 'Incomplete' },
    token: { type: String, default: null },
    fcmToken: {
        type: String,
        default: null
    },
    isActive: { type: Boolean, default: true },
    isOnline: {
        type: Boolean,
        default: true
    },
    profileImage: { type: String, default: null },

    // Location Details
  country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
        location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },


    documents: {
        
        pharmacyImages: [{ type: String }],       // Figma: Pharmacy Image
        pharmacyCertificates: [{ type: String }], // Figma: Pharmacy Certificate Image
        pharmacyLicenses: [{ type: String }],     // Figma: Pharmacy License Certificate
        gstCertificates: [{ type: String }],      // Figma: GST Certificate (Optional)
        drugLicenses: [{ type: String }],        // Figma: Drug License
        otherCertificates: [{ type: String }],   // Figma: Other Certificate (Optional)

        cinNumber: { type: String, default: "" }, //  Compulsory (e.g. "U74999DL2026PTC123456")
        gstNumber: { type: String, default: "" }, // Either GSTIN
        tanNumber: { type: String, default: "" }, //  OR (TAN + PAN)
        panNumber: { type: String, default: "" }, //  OR (TAN + PAN)
        drugLicenseNumber: { type: String, default: "" }, // E.g., "27192-195" ya "DRUG/19-20/32879-80"
        foodLicenseNumber: { type: String, default: "" }, //  E.g., "Food Lic No.: 122200260001" (FSSAI)
        signatureImage: { type: String, default: null },   // Authorised Signator

        documentState: { type: String },
        issuingAuthority: { type: String },
        drugLicenseType: {
            type: String,
            enum: ['Retail', 'Wholesale', 'Restricted', 'Blood Bank', 'None'],
            default: 'Retail'
        }
    },

    alternatePhone: { type: String, default: null },
    rejectionReason: { type: String, default: null },

    isHomeDeliveryAvailable: { type: Boolean, default: true },
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
 
pharmacySchema.index({ location: "2dsphere" });

module.exports = mongoose.model('Pharmacy', pharmacySchema);