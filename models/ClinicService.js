// models/ClinicService.js
const mongoose = require('mongoose');

const clinicServiceSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true
    },
    serviceName: {
      type: String,
      required: true,
      trim: true // e.g. "ECG Test", "Wound Dressing", "Nebulization", "Minor OT"
    },
    price: {
      type: Number,
      required: true
    },
    image: {
      type: String,
      default: null
    },
    description: {
      type: String,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ClinicService', clinicServiceSchema);