const { Schema, model } = require("mongoose");

const clinicSchema = new Schema(
  {
    name: {
      type: String,
      default: "",
    },
    image: {
      type: String,
      default: null,
    },
    posterimage: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: "",
    },
    phoneNumber: { type: String, unique: true, sparse: true },

    alternatePhoneNumber: {
      type: String,
      default: "",
    },
    address: {
      type: String,
      default: "",
    },
    ctrCode: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: "",
    },
    state: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    phnOtp: {
      type: String,
      default: "",
    },
    altphnctrcode: {
      type: String,
      default: "",
    },
    experience: {
      type: String,
      default: "",
    },

    
    // 👈 1. ADDED EXTRA KEYS REQUESTED BY YOU
    licenseNumber: {
      type: String,
      default: "",
    },
    councilName: {
      type: String,
      default: "",
    },
    councilNumber: {
      type: String,
      default: "",
    },
    
    clinicName: {
      type: String,
      default: "",
    },
    certificateImage: {
      type: String,
      default: "",
    },
    CertificateStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    licenseDocument: [{ type: String }], // Array as seen in DB document
    otherDocuments: [{ type: String }], 
    licenceCertificateStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    password: {
      type: String,
      default: "",
    },
    myDocumentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      default: null,
    },
    amount: {
      type: String,
      default: "0",
    },
    token: {
      type: String,
      default: "",
    },
    
    // Kept original Accountverify
    Accountverify: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    ConsultationFeesId: {
      type: Schema.Types.ObjectId,
      ref: "ConsultationFees",
      default: null,
    },
    rejectionReason: { type: String, default: null }, // 🚨 Database se matched rejection field

    regId: {
      type: String,
      default: "",
    },
    chatStatus: {
      type: String,
      default: ""
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isOnline: {
      type: Boolean,
      default: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        default: [0, 0],
        validate: {
          validator: function (value) {
            return Array.isArray(value) && value.length === 2;
          },
          message: 'Coordinates must be [longitude, latitude]',
        },
      },
    },
    SpecialistsId: [
      {
        type: Schema.Types.ObjectId,
        ref: "Specialists",
        default: null,
      },
    ],
    clinicImages: [
      {
        type: String,
        default: ""
      }
    ],
    achievementImages: [
      {
        type: String,
        default: ""
      }
    ],
    DoctorId: [
      {
        type: Schema.Types.ObjectId,
        ref: "Doctor",
        default: null,
      },
    ],
    About: { // Kept original About
      type: String,
      default: ""
    },
    startDay: {
      type: String,
      default: "",
    },
    endDay: {
      type: String,
      default: ""
    },
    MorningStartTime: {
      type: String,
      default: ""
    },
    eveningStartTime: {
      type: String,
      default: ""
    },
    MorningEndTime: {
      type: String,
      default: ""
    },
    eveningEndTime: {
      type: String,
      default: ""
    },
    holiday: {
      type: String,
      default: ""
    },
    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      bankName: { type: String, default: "" },
      upiId: { type: String, default: '' }
    },
  },
  { timestamps: true }
);

clinicSchema.index({ location: '2dsphere' });
module.exports = model("Clinic", clinicSchema);