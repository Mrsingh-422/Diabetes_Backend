const { Schema, model } = require("mongoose");

const documentSchema = Schema(
  {
    registrationNo: {
      type: String,
      default: "",
    },
    // Refactored to string enums
    registrationNoStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    licenceNo: {
      type: String,
      default: "",
    },
    // Refactored to string enums
    licenceNoStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    accreditation: {
      type: String,
      default: "",
    },
    // Refactored to string enums
    accreditationStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    aadharCard: {
      type: [String],
      default: [],
    },
    // Refactored to string enums
    aadharCardStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    panCard: {
      type: [String],
      default: [],
    },
    // Refactored to string enums
    panCardStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    drivingLicence: {
      type: [String],
      default: [],
    },
    // Refactored to string enums
    drivingLicenceStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    doctorCertificate: {
      type: String,
      default: "",
    },
    // Refactored to string enums
    doctorCertificateStatus: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor", // Standardized casing
      default: null,
    },
    // Main Document Profile status (Aligned with profileStatus)
    status: {
      type: String,
      enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
      default: 'Incomplete'
    },
    type: {
      type: String,
      default: "0",
    },
    rejectReasons: {
      type: Map,
      of: String,
      default: {},
    },
    ClinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = model("Document", documentSchema);