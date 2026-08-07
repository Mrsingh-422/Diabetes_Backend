const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    email: { 
      type: String, 
      default: "" 
    },
    phone: { 
      type: String, 
      default: "" 
    },
    registeredAddress: { 
      type: String, 
      default: "" 
    },
    postalAddress: { 
      type: String, 
      default: "" 
    },
    facebookLink: {
      type: String,
      default: ""
    },
    instaLink: {
      type: String,
      default: ""
    },
    youtubeLink: {
      type: String,
      default: ""
    },
    twitterLink: {
      type: String,
      default: ""
    },
    linkedinLink: {
       type: String,
       default: ""
    },
    androidAppLink: {
        type: String,
        default: ""
    },
    iosAppleLink: {
        type: String,
        default: ""
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ContactUs", contactSchema);