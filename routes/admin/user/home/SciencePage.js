const { Router } = require("express");
const router = Router();

// Protect & Multer Middleware
const { protect } = require("../../../../middleware/authMiddleware");
const { scienceUploads } = require("../../../../middleware/multer");

// Controllers
const {
  getSciencePage,
  updateSciencePage,
  addSciencePageItem,
  removeSciencePageItem,
  uploadScienceImages
} = require("../../../../controllers/admin/user/Home/Sciencepage");

// Base Endpoint : /api/homepage/science

// ==========================================
// PUBLIC ROUTES
// ==========================================
router.get(
  "/", 
  getSciencePage
);

// ==========================================
// ADMIN ROUTES (Protected)
// ==========================================
router.put(
  "/update", 
  protect("admin"), 
  scienceUploads, 
  updateSciencePage
);

router.post(
  "/add-item", 
  protect("admin"), 
  addSciencePageItem
);

router.delete(
  "/remove-item", 
  protect("admin"), 
  removeSciencePageItem
);

router.post(
  "/upload", 
  protect("admin"), 
  scienceUploads, 
  uploadScienceImages
);

module.exports = router;