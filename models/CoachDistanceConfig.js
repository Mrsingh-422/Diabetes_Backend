// models/CoachDistanceConfig.js
const mongoose = require('mongoose');

const coachDistanceConfigSchema = new mongoose.Schema({
    freeDistanceKM: {
        type: Number,
        required: [true, "Free distance KM is required"],
        default: 5, // e.g. 5 KM tak free/included
        min: 0
    },
    pricePerKM: {
        type: Number,
        required: [true, "Price per extra KM is required"],
        default: 15, // e.g. ₹15 per extra KM
        min: 0
    },
    maxServiceRadiusKM: {
        type: Number,
        default: 30, // Coach max kitne KM tak travel kar sakta hai
        min: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('CoachDistanceConfig', coachDistanceConfigSchema);