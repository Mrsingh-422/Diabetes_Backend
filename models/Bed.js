// models/Bed.js
const mongoose = require('mongoose');

const bedSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true
    },
    wardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: true,
      index: true
    },
    bedNumber: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['Available', 'Occupied', 'Maintenance', 'Reserved'],
      default: 'Available',
      index: true
    },
    pricePerDay: {
      type: Number,
      required: true,
      default: 0
    },
    isVentilatorAvailable: {
      type: Boolean,
      default: false
    },
    holdExpiresAt: {
      type: Date,
      default: null
    },
    currentAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Bed', bedSchema);