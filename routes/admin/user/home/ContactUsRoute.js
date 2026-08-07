const { Router } = require("express");
const router = Router();

// Protect Middleware
const { protect } = require("../../../../middleware/authMiddleware");

// Controllers
const { 
  addContact, 
  getContact, 
  updateContact 
} = require("../../../../controllers/admin/user/Home/Contactus");

// Base Endpoint: /api/contactus

// ==========================================
// ADMIN ROUTES (Protected)
// ==========================================
router.post(
  "/create-contact", 
  protect("admin"), 
  addContact
);

router.get(
  "/get-contact", 
  protect("admin"), 
  getContact
);

router.put(
  "/update-contact", 
  protect("admin"), 
  updateContact
);

// ==========================================
// USER ROUTES (Public)
// ==========================================
router.get(
  "/get-contact-user", 
  getContact
);

module.exports = router;