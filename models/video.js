const { Schema, model } = require("mongoose");
 
const videoSchema = new Schema(
  {
    // Existing fields for file uploads (UNCHANGED)
    video1: {
      type: String,
      default: "",
    },
    thumbnail1: {
      type: String,
      default: "",
    },
    video2: {
      type: String,
      default: "",
    },
    thumbnail2: {
      type: String,
      default: "",
    },
    video3: {
      type: String,
      default: "",
    },
    thumbnail3: {
      type: String,
      default: "",
    },
    video4: {
      type: String,
      default: "",
    },
    thumbnail4: {
      type: String,
      default: "",
    },
    video5: {
      type: String,
      default: "",
    },
    thumbnail5: {
      type: String,
      default: "",
    },
    video6: {
      type: String,
      default: "",
    },
    thumbnail6: {
      type: String,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true
    },
   
    youtubeLinks: [
        {
          url: {
            type: String,
            required: true
          },
          videoId: {
            type: String,
            required: true
          },
          thumbnail: { type: String },
          title: { type: String },
          isActive: {
            type: Boolean,
            default: true,     
          },
          addedAt: {
            type: Date,
            default: Date.now
          },
        }
      ],
  },
  { timestamps: true }
);
 
module.exports = model("Video", videoSchema);
 