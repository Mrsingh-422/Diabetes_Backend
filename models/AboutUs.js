// modal/AboutUs.js
const mongoose = require('mongoose');

const aboutUsSchema = new mongoose.Schema({
  // Hero Section
  heroTitle: {
    type: String,
    default: "About Us"
  },
  heroDescription: {
    type: String,
    default: ""
  },
  heroImage: {
    type: String,
    default: ""
  },

  // Main Content Section
  mainTitle: {
    type: String,
    default: "We Provide Finest Patient's Care & Amenities"
  },
  mainDescription: {
    type: String,
    default: ""
  },
  mainImage: {
    type: String,
    default: ""
  },

  // Features Lists
  leftFeatures: [{
    type: String,
    default: []
  }],
  rightFeatures: [{
    type: String,
    default: []
  }],

  // Additional Content
  additionalContent: {
    type: String,
    default: ""
  },
  priorityStatement: {
    type: String,
    default: "YOUR HEALTH IS OUR TOP PRIORITY"
  },

  // Testimonials Section
  testimonials: [{
    text: String,
    author: String,
    image: String,
    rating: Number
  }],

  // Stats
  stats: {
    patientReviews: {
      type: String,
      default: "5k+"
    },
    googleRating: {
      type: String,
      default: "4.9"
    }
  },

  // More About Us Section
  moreAboutTitle: {
    type: String,
    default: "We Are A Clinic, Provide Excellence In Personalized Care"
  },
  moreAboutDescription: {
    type: String,
    default: ""
  },
  moreAboutImage: {
    type: String,
    default: ""
  },
  moreAboutSideImage: {
    type: String,
    default: ""
  },
  moreAboutSideDescription: {
    type: String,
    default: ""
  },

  // Cards Section
  cards: [{
    title: String,
    description: String,
    image: String,
    backgroundColor: String
  }],

  // Mission Vision Values
  missionVision: [{
    type: {
      type: String,
      enum: ['mission', 'vision', 'values']
    },
    title: String,
    description: String,
    icon: String,
    backgroundColor: String
  }],

  // Insurance Section
  insuranceTitle: {
    type: String,
    default: "Our Accepted Insurance"
  },
  insuranceLogos: [{
    type: String,
    default: []
  }],

  // Status
  isActive: {
    type: Boolean,
    default: true
  },

  // Metadata
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AboutUs', aboutUsSchema);