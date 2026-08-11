const { Schema, model } = require("mongoose");

const clinicSchema = new Schema(
  {
    name: {
      type: String,
      default: "",
    },
    image: {
      type: String,
      default: null, // Unified default as null matching Pharmacy/Lab models
    },
    posterimage: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: "",
    },
    phoneNumber: {
      type: String,
      default: "",
    },
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
    licenceNumber: {
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
    // Updated to use the professional enum pattern
    CertificateStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    licenceCertificate: {
      type: String,
      default: "",
    },
    // Updated to use the professional enum pattern
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
    // Aligned to act as the global profile status
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
    rejectReason: {
      type: String,
      default: "",
    },
    regId: {
      type: String,
      default: "",
    },
    chatStatus: {
      type: String,
      default: ""
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
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
    About: {
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