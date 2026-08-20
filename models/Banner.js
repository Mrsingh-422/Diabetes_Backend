// models/Banner.js
const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    title: { type: String, required: true }, // Main Title Headline
    image: [{ type: String, required: true }], // Image/Video URL Array (Cloudinary/S3/Local)
    link: { type: String },  // App Navigation Path e.g. "/medicine/list"
    
    // Kis page par dikhana hai
    category: { 
        type: String, 
        enum: ['Home', 'Medicine', 'Food', 'Lab',  'Ambulance', 'General'], 
        default: 'Home' 
    },
    
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    priority: { type: Number, default: 0 }, // Banners ka sequence (0, 1, 2...)
    
    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date },
    
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // 🚨 ADDED THESE EXTRA OPTIONAL KEYS TO SUPPORT RICH FOOD VIDEO SLIDERS [cite: custom_context]
    type: { 
        type: String, 
        enum: ['video', 'image'], 
        default: 'image' 
    }, // Background type selector
    
    badgeText: { 
        type: String, 
        default: "" 
    }, // Pulsing Badge Tagline
    
    taglineColor: { 
        type: String, 
        default: '#00B574' 
    }, // Tagline Accent Color HEX
    
    description: { 
        type: String, 
        default: "" 
    }, // Description Subtext
    
    overlayOpacity: { 
        type: Number, 
        min: 10, 
        max: 90, 
        default: 60 
    } // Dark Overlay Opacity

}, { timestamps: true });

module.exports = mongoose.model('Banner', bannerSchema);