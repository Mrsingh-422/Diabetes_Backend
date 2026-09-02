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
      trim: true // e.g. "DC-01", "OBS-02", "GEN-05"
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
    currentAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Bed', bedSchema);