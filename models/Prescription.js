const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // For manual patient uploads
    prescriptionImages: [{ type: String }],
    isManualUpload: { type: Boolean, default: false },

    // Core Medical Sections
    chiefComplaints: { type: String, default: "" },
    diagnosis: [{ type: String }],

    // Vitals Snapshot at Prescription Time
    vitals: {
        bp: { type: String, default: "" },
        pulse: { type: String, default: "" },
        temp: { type: String, default: "" },
        spo2: { type: String, default: "" }
    },

    // Medicines Table with Full Dose, Frequency & Time-of-Day Schedule
    medicines: [{
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
        name: { type: String, required: true },
        isCustomGeneric: { type: Boolean, default: false },
        genericComposition: { type: String, default: "" },
        strength: { type: String, default: "" },             // e.g. "500mg"
        frequency: { type: String, default: "" },            // e.g. "b.d. (Twice a day)"
        doseInterval: { type: String, default: "" },         // e.g. "1-0-1"
        dose: { type: String, default: "" },                 // Backward compatible e.g. "1-0-1"
        time: { type: String, default: "" },                 // e.g. "Morning - Night"
        duration: { type: String, default: "" },             // e.g. "5 Days"
        dispenseQuantity: { type: String, default: "" },     // e.g. "10 Tablets"
        administrationTiming: { type: String, default: "" }, // e.g. "p.c. (After meals)"
        instructions: { type: String, default: "" },
        timeSchedule: {
            morning: { type: Boolean, default: false },
            afternoon: { type: Boolean, default: false },
            evening: { type: Boolean, default: false },
            night: { type: Boolean, default: false },
            mealRelation: {
                type: String,
                enum: ['Before Meal', 'After Meal', 'With Meal', 'Empty Stomach', 'Anytime', ''],
                default: ''
            },
            customTimes: [{ type: String }] // e.g. ["08:30 AM", "09:00 PM"]
        }
    }],

    // Advised Investigations & Doctor Suggestions
    advisedInvestigations: { type: String, default: "" },
    doctorSuggestions: { type: String, default: "" },
    adviceGiven: { type: String, default: "" },
    specialInstructions: { type: String, default: "" },
    nextAppointment: { type: String, default: "" },

    pdfUrl: { type: String, default: null },
    dietPlanPdf: { type: String, default: null },
    additionalNotes: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model('Prescription', prescriptionSchema);