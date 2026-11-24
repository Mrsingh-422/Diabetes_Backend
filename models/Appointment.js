// models/Appointment.js
const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    isDoctorSelectedAlready: { type: Boolean, default: false },
    doctorAcceptanceStatus: {
        type: String,
        enum: ['Pending', 'Accepted', 'Rejected'],
        default: 'Pending'
    },
    doctorRejectionReason: { type: String, default: "" },
    doctorRespondedAt: { type: Date, default: null },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null },
    wardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ward', default: null },
    opdAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', default: null },

    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', default: null },
    bookingType: { type: String, enum: ['Appointment', 'Admission', 'Emergency'], default: 'Appointment' },
    bedBookingType: {
        type: String,
        enum: ['General-Bed', 'Emergency-Bed'],
        default: 'General-Bed'
    },
    bookingReason: { type: String, default: "" },

    patients: [{
        patientName: { type: String, required: true },
        patientAge: { type: Number, required: true },
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: { type: String, default: 'Self' },
        reasonForVisit: { type: String },
        isMainUser: { type: Boolean, default: false }
    }],
    address: {
        name: String,
        phone: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        pincode: String,
        addressType: { type: String, default: 'Home' }
    },

    appointmentDate: { type: Date },
    appointmentTime: { type: String },
    rescheduleReason: { type: String, default: "" },
    consultationType: {
        type: String,
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit']
    },

    // --- OPD Token & Queue Tracking ---
    tokenNumber: { type: Number, default: null },
    formattedToken: { type: String, default: "" },
    tokenIntervalMinutes: { type: Number, default: 15 },
    opdRoomNumber: { type: String, default: "" },
    isTokenSkipped: { type: Boolean, default: false },
    tokenSkipCount: { type: Number, default: 0 },
    tokenSkippedAt: { type: Date, default: null },
    tokenSkipReason: { type: String, default: "" },

    // --- Pricing & Coupon Logic ---
    pricingBreakdown: {
        baseFee: { type: Number },
        originalBaseFee: { type: Number, default: 0 },
        visitCharges: { type: Number, default: 0 },
        extraCharges: { type: Number, default: 0 },
        discountAmount: { type: Number, default: 0 },
        subtotal: { type: Number },
        cancellationFeeApplied: { type: Number, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },
    couponDetails: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        couponCode: { type: String },
        discountValue: { type: Number }
    },
    insuranceDetails: {
        hasInsurance: { type: Boolean, default: false },
        insuranceNumber: { type: String, default: "" },
        companyName: { type: String, default: "" },
        insuranceType: { type: String, default: "" },
        insuranceDocument: { type: String, default: null }
    },

    totalAmount: { type: Number },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded', 'Refund-Initiated'], default: 'Pending' },
    transactionId: { type: String },

    status: {
        type: String,
        enum: ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending', 'Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show', 'Rescheduled'],
        default: 'Pending'
    },
    stayDuration: { type: Number, default: 0 },
    bookingId: { type: String, unique: true },
    triageLevel: { type: String, enum: ['Emergency', 'Very Urgent', 'Urgent', 'Routine'] },
    wardName: { type: String },
    bedNumber: { type: String },
    specialServices: [{
        serviceName: String,
        price: Number
    }],

    startDate: { type: Date },
    endDate: { type: Date },
    cancellationCount: { type: Number, default: 0 },
    rescheduleCount: { type: Number, default: 0 },

    pendingDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    treatmentHistory: [{
        fromDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
        toDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
        action: {
            type: String,
            enum: ['Initial-Assignment', 'Transfer-Initiated', 'Transfer-Accepted', 'Transfer-Rejected', 'Discharged'],
            default: 'Initial-Assignment'
        },
        acceptanceStatus: {
            type: String,
            enum: ['Pending-Acceptance', 'Accepted', 'Rejected-By-Doctor', 'Unaccepted-Reassigned', 'Replaced-After-Acceptance', 'Completed'],
            default: 'Pending-Acceptance'
        },
        assignedAt: { type: Date, default: Date.now },
        acceptedAt: { type: Date, default: null },
        unacceptedWaitDuration: { type: String, default: "" },
        rejectionReason: { type: String, default: "" },
        notes: { type: String, default: "" },
        subscriptionDetails: {
            isSubscriptionApplied: { type: Boolean, default: false },
            userSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', default: null },
            planName: { type: String, default: "" }
        },
        timestamp: { type: Date, default: Date.now },
        startTime: { type: Date, default: null },
        endTime: { type: Date, default: null },
        durationDisplay: { type: String, default: "" }
    }],

    clinicalSummary: {
        diagnosis: { type: String, default: "" },
        investigation: { type: String, default: "" },
        doctorSuggestions: { type: String, default: "" },
        treatmentResult: { type: String, default: "" },
        dischargeNote: { type: String, default: "" },
        dischargedAt: { type: Date, default: null },

        uploadedReports: [{ type: String }],

        chiefComplaint: { type: String, default: "" },
        triagePriority: { type: String, default: "" },
        admissionNote: { type: String, default: "" },
        bloodGroup: { type: String, default: "" },

        vitals: {
            bp: { type: String, default: "" },
            pulse: { type: String, default: "" },
            temp: { type: String, default: "" },
            spo2: { type: String, default: "" },
            notes: { type: String, default: "" },
            recordedAt: { type: Date, default: null },
            recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null }
        },

        dateOfSurgery: { type: Date, default: null },
        conditionDuringAdmission: { type: String, default: "" },
        conditionDuringDischarge: { type: String, default: "" },
        dischargeSummaryPdf: { type: String, default: null }
    },

    // --- CLINIC PHARMACY REFERRAL (Direct Read-Only Display to Clinic Pharmacy) ---
    clinicPharmacyReferral: {
        pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', default: null },
        prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', default: null },
        medicines: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
            name: { type: String, required: true },
            saltComposition: { type: String, default: "" },
            packaging: { type: String, default: "" },
            strength: { type: String, default: "" },
            dose: { type: String, default: "" },
            doseInterval: { type: String, default: "" },
            frequency: { type: String, default: "" },
            duration: { type: String, default: "" },
            quantity: { type: Number, default: 1 },
            dispenseQuantity: { type: String, default: "" },
            administrationTiming: { type: String, default: "" },
            instructions: { type: String, default: "" },
            timeSchedule: {
                morning: { type: Boolean, default: false },
                afternoon: { type: Boolean, default: false },
                evening: { type: Boolean, default: false },
                night: { type: Boolean, default: false },
                mealRelation: { type: String, default: "" },
                customTimes: [{ type: String }]
            },
            unitPrice: { type: Number, default: 0 }
        }],
        notes: { type: String, default: "" },
        status: { type: String, enum: ['None', 'Sent', 'Dispensed', 'Cancelled'], default: 'None' },
        sentAt: { type: Date, default: null },
        sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null }
    },

    // --- CLINIC LAB REFERRAL (Direct Read-Only Display to Clinic Lab) ---
    clinicLabReferral: {
        labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', default: null },
        tests: [{
            testId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest', default: null },
            packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPackage', default: null },
            itemType: { type: String, enum: ['LabTest', 'LabPackage', 'Manual'], default: 'LabTest' },
            name: { type: String, required: true },
            price: { type: Number, default: 0 },
            instructions: { type: String, default: "" }
        }],
        notes: { type: String, default: "" },
        priority: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], default: 'Routine' },
        status: { type: String, enum: ['None', 'Sent', 'Sample-Collected', 'Report-Ready', 'Cancelled'], default: 'None' },
        sentAt: { type: Date, default: null },
        sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null }
    },

    // --- CLINIC ADMISSION / IPD REFERRAL ---
    admissionReferral: {
        status: { type: String, enum: ['None', 'Recommended', 'Reserved', 'Admitted', 'Cancelled'], default: 'None' },
        admissionAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
        wardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ward', default: null },
        bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null },
        wardType: { type: String, default: "" },
        triageLevel: { type: String, enum: ['Emergency', 'Very Urgent', 'Urgent', 'Routine', ''], default: '' },
        stayDuration: { type: Number, default: 1 },
        reason: { type: String, default: "" },
        notes: { type: String, default: "" },
        referredAt: { type: Date, default: null },
        referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null }
    },

    // --- SECONDARY DOCTORS / SECOND OPINION TEAM ---
    bedsideCareTeam: [{
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
        roleType: { type: String, enum: ['Secondary-Doctor', 'Second-Opinion'], default: 'Secondary-Doctor' },
        status: { type: String, enum: ['Pending', 'Accepted', 'In-Progress', 'Completed', 'Rejected'], default: 'Pending' },
        requestReason: { type: String, default: "" },
        patientConditionAtRequest: { type: String, default: "" },
        priority: { type: String, enum: ['Most Urgent', 'Urgent', 'Routine'], default: 'Routine' },
        rejectionReason: { type: String, default: "" },
        specialistFeedback: [{
            observation: { type: String, default: "" },
            patientCondition: { type: String, default: "" },
            priorityRating: { type: String, default: "" },
            vitals: {
                bp: { type: String, default: "" },
                pulse: { type: String, default: "" },
                temp: { type: String, default: "" },
                spo2: { type: String, default: "" }
            },
            submittedAt: { type: Date, default: Date.now }
        }],
        requestedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null }
    }],

    paymentDetails: {
        razorpayPaymentId: { type: String, default: "" },
        razorpayOrderId: { type: String, default: "" },
        razorpaySignature: { type: String, default: "" },
        method: { type: String, default: "" },
        amount: { type: Number, default: 0 },
        currency: { type: String, default: "INR" },
        status: { type: String, default: "" },
        bank: { type: String, default: "" },
        wallet: { type: String, default: "" },
        vpa: { type: String, default: "" },
        cardDetails: {
            last4: String,
            network: String,
            type: String
        },
        paidAt: { type: Date, default: null }
    },
    cancellationDetails: {
        cancelledBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'role' },
        reason: { type: String, default: "" },
        cancelledAt: { type: Date, default: null },
        isPermanent: { type: Boolean, default: false },
        refundAmountCalculated: { type: Number, default: 0 },
        penaltyApplied: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);