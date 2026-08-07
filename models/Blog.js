const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    blogImage: {
      type: String,
      default: ""
    },
    createdBy: {
      type: String,
      default: ""
    },
    conclusion: {
      type: String,
      default: ""
    },
    subheadings: [
      {
        title: { type: String, default: "" },
        description: { type: String, default: "" }
      }
    ],
    type: {
      type: String,
      enum: ["Doctor Tips", "Mind & Body", "Monitoring", "Food Lab", "Recipes", "Food & Nutrition"],
      required: true
    },
    viewCount: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    // --- Integrated Hero Section Keys ---
    badgeText: {
      type: String,
      default: "The Diabetes Knowledge Hub"
    },
    headlinePart1: {
      type: String,
      default: "Your Guide to a"
    },
    headlinePart2: {
      type: String,
      default: "Limitless Life."
    },
    subheadline: {
      type: String,
      default: "Expert-backed articles, nutritional science, and hormonal insights to help you manage and reverse diabetes effectively."
    },
    trendingTopic: {
      type: String,
      default: "The HbA1c Reversal Protocol 2026"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Blog', blogSchema);