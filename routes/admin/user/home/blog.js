const { Router } = require("express");
const router = Router();

// Protect & Multer Middleware 
const { protect } = require("../../../../middleware/authMiddleware");
const { blogUploads } = require("../../../../middleware/multer");

// Controllers
const {
  createBlog,
  updateBlog,
  deleteBlog,
  getAdminBlogs,
  getUserBlogs,
  getParticularBlog,
  updateBlogHero,
  getBlogHero
} = require("../../../../controllers/admin/user/Home/blog");

// Base Endpoint: /api/homepage/blogs

// ==========================================
// ADMIN BLOG ROUTES (Required 'admin' Auth)
// ==========================================
router.post("/admin/create", protect("admin"), blogUploads, createBlog);
router.put("/admin/update/:id", protect("admin"), blogUploads, updateBlog);
router.delete("/admin/delete/:id", protect("admin"), deleteBlog);
router.get("/admin/get", protect("admin"), getAdminBlogs);

// Edit Endpoint to update Hero Texts dynamically across the whole blog system
router.put("/admin/update-hero", protect("admin"), updateBlogHero);


// ==========================================
// USER BLOG ROUTES (Public)
// ==========================================
router.get("/user/get", getUserBlogs);
router.get("/user/get/:id", getParticularBlog);

// Load the current customized hero texts for your frontend UI
router.get("/user/get-hero", getBlogHero);

module.exports = router;