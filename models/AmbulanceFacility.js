// models/AmbulanceFacility.js
const mongoose = require('mongoose');

const ambulanceFacilitySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, "Facility / Staff name is required"], 
        trim: true,
        unique: true // e.g. "Nurse", "Doctor", "Oxygen Cylinder", "Ventilator"
    },
    description: { 
        type: String, 
        default: "" 
    },
    defaultPrice: { 
        type: Number, 
        default: 0,
        min: 0 
    },
    applicableFor: { 
        type: String, 
        enum: ['all', 'clinic-ambulance', 'ambulance'], 
        default: 'all' 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    createdBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin' 
    }
}, { timestamps: true });

module.exports = mongoose.model('AmbulanceFacility', ambulanceFacilitySchema);