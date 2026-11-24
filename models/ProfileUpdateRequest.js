const mongoose = require('mongoose');

const profileUpdateRequestSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorModel' 
    },
    vendorModel: { 
        type: String, 
        enum: ['Doctor', 'Food', 'Pharmacy', 'Lab', 'Ambulance', 'Driver', 'Clinic'], 
        required: true 
    },
    clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        default: null,
        index: true
    },
    updatedFields: { 
        type: Object, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending' 
    },
    rejectionReason: { 
        type: String, 
        default: "" 
    },
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        default: null 
    },
    reviewedByClinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        default: null
    },
    reviewedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('ProfileUpdateRequest', profileUpdateRequestSchema);