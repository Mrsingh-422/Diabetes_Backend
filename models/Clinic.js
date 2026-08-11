const { Schema, model } = require("mongoose");

const clinicschema  = Schema({
    name: {
        type: String,
        default: "",
      },
      image: {
        type: String,
        default: "",
      },
      posterimage: {
        type: String,
        default: "",
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
      CertificateStatus: {
        type: String,
        default: "0",
      },
      licenceCertificate: {
        type: String,
        default: "",
      },
      licenceCertificateStatus: {
        type: String,
        default: "0",
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
      Accountverify:{
        type:String,
        default:"0"
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
      chatStatus:{
        type:String,
        default:""
      },
      // longitude:{
      //   type:String,
      //   default:""
      // },
      // latitude:{
      //   type:String,
      //   default:""
      // },
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
    default: [0, 0], // optional, or set null and validate
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
      clinicImages:[{
        type:String,
        default:""
      } ],

      achievementImages:[{
        type:String,
        default:""
      } ], 



      DoctorId: [
        {
          type: Schema.Types.ObjectId,
          ref: "Doctor",
          default: null,
        },
        
      ],
     About :{
      type: String,
      default:""
     },
      startDay:{
        type:String,
        default:"",
      },
      endDay:{
        type:String,
        default:""
      },
      MorningStartTime:{
        type:String,
        default:""
      },
      eveningStartTime:{
        type:String,
        default:""
      },
      MorningEndTime:{
        type:String,
        default:""
      },
      eveningEndTime:{
        type:String,
        default:""
      },
    holiday:{
      type:String,
      default:""
    },
    bankDetails: {
    accountHolderName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    ifscCode: { type: String, default: "" },
    bankName: { type: String, default: "" },
        upiId: { type: String, default: '' } // Optional

},
    
}, { timestamps: true }

);
clinicschema.index({ location: '2dsphere' });
module.exports = model("Clinic", clinicschema)