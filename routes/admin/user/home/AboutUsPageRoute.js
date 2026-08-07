const { Router } = require("express");
const router = Router();

// Protect & Multer Middleware
const { protect } = require("../../../../middleware/authMiddleware");
const { aboutUsUploads } = require("../../../../middleware/multer");

// Controllers
const {
  getAboutUs,
  updateAboutUs,
  uploadImage
} = require("../../../../controllers/admin/user/Home/AboutUsPage");

// Base Endpoint: /api/aboutus

// ==========================================
// PUBLIC USER ROUTES
// ==========================================

// Fetch customized About Us data for client frontends (No Auth Required)
router.get(
  "/get-about-us", 
  getAboutUs
);

// ==========================================
// ADMIN ROUTES (Protected)
// ==========================================

// Fetch About Us data for the Admin panel view
router.get(
  "/admin/get-about-us", 
  protect("admin"), 
  getAboutUs
);

// Update About Us fields, structures, and images
router.put(
  "/admin/update-about-us", 
  protect("admin"), 
  aboutUsUploads, 
  updateAboutUs
);

// Upload a single clinical/layout asset independently
router.post(
  "/admin/upload-image", 
  protect("admin"), 
  aboutUsUploads, 
  uploadImage
);

module.exports = router;