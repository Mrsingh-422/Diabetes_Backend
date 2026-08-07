const { Router } = require("express");
const router = Router();

// Protect & Multer Middleware
const { protect } = require("../../../../middleware/authMiddleware");
const { footerUploads } = require("../../../../middleware/multer");

// Controllers
const {
  createContent,
  getContent,
  updateContent,
  createPolicy,
  getPolicy,
  updatePolicy
} = require("../../../../controllers/admin/user/Home/FooterController");

// Base Endpoint: /api/footer

/* ==================== FOOTER CONTENT ROUTES ==================== */

// Create Footer Content
router.post(
  "/create-footer",
  protect("admin"),
  footerUploads,
  createContent
);

// Get Footer Content (Admin)
router.get(
  "/get-footer",
  protect("admin"),
  getContent
);

// Get Footer Content (Public)
router.get(
  "/get-footer-user",
  getContent
);

// Update Footer Content
router.put(
  "/update-footer/:id",
  protect("admin"),
  footerUploads,
  updateContent
);

/* ==================== POLICY ROUTES ==================== */

// Create Policy
router.post(
  "/create-policy",
  protect("admin"),
  createPolicy
);

// Get Policy (Admin)
router.get(
  "/get-policy",
  protect("admin"),
  getPolicy
);

// Get Policy (Public)
router.get(
  "/get-policy-user",
  getPolicy
);

// Update Policy
router.put(
  "/update-policy",
  protect("admin"),
  updatePolicy
);

module.exports = router;