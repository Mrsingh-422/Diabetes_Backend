// models/ReferredToAnotherDoctor.js
const mongoose = require('mongoose');

const referredToAnotherDoctorSchema = new mongoose.Schema({
    referralCode: { type: String, unique: true, required: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Source OPD / IPD Appointment & Referring Doctor
    sourceAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    referredByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', default: null },

    // Target Referred Doctor
    referredToDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },

    reason: { type: String, default: "" },
    clinicalNotes: { type: String, default: "" },
    priority: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], default: 'Routine' },

    // Workflow Status (Pending at Clinic Reception -> Booked & Paid)
    status: {
        type: String,
        enum: ['Pending-Clinic-Booking', 'Booked-And-Paid', 'Completed', 'Cancelled'],
        default: 'Pending-Clinic-Booking',
        index: true
    },

    // Booked Appointment & Slot Details (Filled when Clinic Reception books & collects fee)
    bookedAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    referredDate: { type: Date, default: null },
    referredSlotTime: { type: String, default: "" },
    feeAmount: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ['Cash', 'UPI', 'Card', 'Online', 'COD', ''], default: '' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Pending' },
    transactionReference: { type: String, default: "" },
    bookedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('ReferredToAnotherDoctor', referredToAnotherDoctorSchema);