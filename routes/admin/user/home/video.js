const { Router } = require("express");
const { protect } = require("../../../../middleware/authMiddleware");
const {videoUploads, videoUpdateUploads} = require("../../../../middleware/multer");
const {
  createVideo,
  getVideo,
  upadateVideo,
  addYoutubeLink,
  getYoutubeLinks,
  deleteYoutubeLink,
  updateYoutubeLink,
  toggleVideoStatus,
  toggleYoutubeLinkStatus
} = require("../../../../controllers/admin/user/Home/video");

const route = Router();
 
// // ==================== MULTER CONFIGURATION (EXISTING - UNCHANGED) ====================
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     if (file.fieldname.startsWith("video")) {
//       cb(null, "uploads/admin/user/video");
//     } else if (file.fieldname.startsWith("thumbnail")) {
//       cb(null, "uploads/admin/user/thumbnail");
//     }
//   },
//   filename: function (req, file, cb) {
//     cb(null, Date.now() + "-" + file.originalname);
//   },
// });
 
// const storage1 = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, "uploads/admin/user/video");
//   },
//   filename: function (req, file, cb) {
//     cb(null, Date.now() + "-" + file.originalname);
//   },
// });
 
// const upload = multer({
//   storage: storage,
//   limits: {
//     fileSize: 80 * 1024 * 1024, // 20 MB in bytes
//   },
// });
 
// const upload1 = multer({
//   storage: storage1,
//   limits: {
//     fileSize: 80 * 1024 * 1024, // 80 MB in bytes
//   },
//   fileFilter: (req, file, cb) => {
//     const fileSize = parseInt(req.headers["content-length"]);
//     if (fileSize > 80 * 1024 * 1024) {
//       return cb(new Error("Total file size should not exceed 80 MB"), false);
//     }
//     cb(null, true);
//   },
// });


// Base Endpoint: /upload-videos
 
// // ==================== EXISTING ROUTES (UNCHANGED) ====================
route.post(
  "/video",
  protect("admin"),
  videoUpdateUploads,
  createVideo
);
 
route.patch(
  "/videoupdate/:id",
  protect("admin"),
  videoUpdateUploads,
  upadateVideo
);
route.patch(
  "/video-status/:id",
  protect("admin"),
  toggleVideoStatus
);
 
route.get("/getVideo", getVideo);
 
// ==================== YOUTUBE ROUTES (NEW) ====================
 
// Add YouTube link
// POST: /upload-videos/add-youtube-link
route.post("/add-youtube-link", protect("admin"), videoUploads,addYoutubeLink);
 
// Get all YouTube links
// GET: /upload-videos/get-youtube-links
route.get("/get-youtube-links", getYoutubeLinks);
 
// Update YouTube link
// PUT: /upload-videos/update-youtube-link/:linkId
route.put("/update-youtube-link/:linkId", protect("admin"), videoUpdateUploads,updateYoutubeLink);

route.patch("/youtube-status/:linkId", protect("admin"), toggleYoutubeLinkStatus);
 
// Delete YouTube link
// DELETE: /upload-videos/delete-youtube-link/:linkId
route.delete("/delete-youtube-link/:linkId", protect("admin"), deleteYoutubeLink);
 
module.exports = route;
 