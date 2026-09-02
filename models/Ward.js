// models/Ward.js
const mongoose = require('mongoose');

const wardSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true // e.g. "Daycare Ward", "Observation Unit", "Recovery Room", "General Ward"
    },
    type: {
      type: String,
      enum: ['General', 'Daycare', 'Observation', 'ICU', 'Private Room', 'Semi-Private'],
      default: 'Daycare'
    },
    totalBeds: {
      type: Number,
      required: true,
      min: 1
    },
    availableBeds: {
      type: Number,
      required: true
    },
    pricePerDay: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ward', wardSchema);