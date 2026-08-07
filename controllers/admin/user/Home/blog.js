const Blog = require("../../../../models/Blog");

// Safe Helper to parse Subheadings if sent as a JSON string from Frontend
const parseSubheadings = (data) => {
  if (!data) return [];
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    return [];
  }
};

// ==========================================
// ADMIN CONTROLLERS
// ==========================================

// 1. Create Blog
const createBlog = async (req, res) => {
  try {
    const { title, description, type, conclusion } = req.body;

    if (!title || !description || !type) {
      return res.status(400).json({ success: 0, message: "Title, Description, and Type are mandatory" });
    }

    const subheadings = parseSubheadings(req.body.subheadings);
    const authorName = req.user.name || "Admin";

    // Replicate the latest synchronized Hero configuration values on the newly created blog
    const latestBlog = await Blog.findOne().sort({ createdAt: -1 });

    const blogData = {
      title,
      description,
      type,
      conclusion: conclusion || "",
      createdBy: authorName,
      subheadings,
      blogImage: req.file ? `/uploads/blogs/${req.file.filename}` : "",
      badgeText: latestBlog ? latestBlog.badgeText : "The Diabetes Knowledge Hub",
      headlinePart1: latestBlog ? latestBlog.headlinePart1 : "Your Guide to a",
      headlinePart2: latestBlog ? latestBlog.headlinePart2 : "Limitless Life.",
      subheadline: latestBlog ? latestBlog.subheadline : "Expert-backed articles, nutritional science, and hormonal insights...",
      trendingTopic: latestBlog ? latestBlog.trendingTopic : "The HbA1c Reversal Protocol 2026"
    };

    const newBlog = await Blog.create(blogData);

    return res.status(201).json({
      success: 1,
      message: "Blog created successfully",
      data: newBlog
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 2. Update Blog
const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, type, conclusion, isActive } = req.body;

    const blog = await Blog.findById(id);
    if (!blog) {
      return res.status(404).json({ success: 0, message: "Blog not found" });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (conclusion !== undefined) updateData.conclusion = conclusion;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    if (req.body.subheadings !== undefined) {
      updateData.subheadings = parseSubheadings(req.body.subheadings);
    }

    if (req.file) {
      updateData.blogImage = `/uploads/blogs/${req.file.filename}`;
    }

    const updatedBlog = await Blog.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    return res.status(200).json({
      success: 1,
      message: "Blog updated successfully",
      data: updatedBlog
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 3. Delete Blog
const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findByIdAndDelete(id);

    if (!blog) {
      return res.status(404).json({ success: 0, message: "Blog not found" });
    }

    return res.status(200).json({
      success: 1,
      message: "Blog deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 4. Get Admin Blogs (Includes Pagination & Search)
const getAdminBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.q || "";
    const skip = (page - 1) * limit;

    let query = {};
    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { title: { $regex: regex } },
        { description: { $regex: regex } },
        { type: { $regex: regex } }
      ];
    }

    const totalBlogs = await Blog.countDocuments(query);
    const blogs = await Blog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: 1,
      message: "Admin blogs fetched",
      totalPages: Math.ceil(totalBlogs / limit),
      currentPage: page,
      totalCount: totalBlogs,
      data: blogs
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 5. Update Blog Hero Section (Edit API - Admin Protected)
const updateBlogHero = async (req, res) => {
  try {
    const { badgeText, headlinePart1, headlinePart2, subheadline, trendingTopic } = req.body;

    const updateData = {};
    if (badgeText !== undefined) updateData.badgeText = badgeText;
    if (headlinePart1 !== undefined) updateData.headlinePart1 = headlinePart1;
    if (headlinePart2 !== undefined) updateData.headlinePart2 = headlinePart2;
    if (subheadline !== undefined) updateData.subheadline = subheadline;
    if (trendingTopic !== undefined) updateData.trendingTopic = trendingTopic;

    // Updates all documents globally so that any fetched blog reflects the exact same landing page header config
    await Blog.updateMany({}, updateData);

    return res.status(200).json({
      success: 1,
      message: "Blog Hero configuration updated successfully across all documents",
      data: updateData
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};


// ==========================================
// USER CONTROLLERS (Public / Users Access)
// ==========================================

// 1. Get Blogs List (Includes Pagination, Search, and Category Filters)
const getUserBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.q || "";
    const category = req.query.category || "";
    const skip = (page - 1) * limit;

    let query = { isActive: true };

    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { title: { $regex: regex } },
        { description: { $regex: regex } }
      ];
    }

    if (category) {
      const allowedCategories = ["Doctor Tips", "Mind & Body", "Monitoring", "Food Lab", "Recipes", "Food & Nutrition"];
      if (allowedCategories.includes(category)) {
        query.type = category;
      } else {
        return res.status(400).json({
          success: 0,
          message: "Invalid category filter"
        });
      }
    }

    const totalBlogs = await Blog.countDocuments(query);
    const blogs = await Blog.find(query)
      .select('title description blogImage type viewCount createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: 1,
      message: "Blogs fetched successfully",
      totalPages: Math.ceil(totalBlogs / limit),
      currentPage: page,
      totalCount: totalBlogs,
      data: blogs
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 2. Get Particular Blog Details
const getParticularBlog = async (req, res) => {
  try {
    const { id } = req.params;

    const blog = await Blog.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
      { new: true }
    );

    if (!blog) {
      return res.status(404).json({ success: 0, message: "Blog not found" });
    }

    return res.status(200).json({
      success: 1,
      message: "Blog detailed fetched successfully",
      data: blog
    });
  } catch (error) {
    return res.status(500).json({ success: 0, message: error.message });
  }
};

// 3. Get Blog Hero Texts (User Side)
const getBlogHero = async (req, res) => {
  try {
    const latestBlog = await Blog.findOne({ isActive: true }).sort({ createdAt: -1 });

    const defaultHero = {
      badgeText: "The Diabetes Knowledge Hub",
      headlinePart1: "Your Guide to a",
      headlinePart2: "Limitless Life.",
      subheadline: "Expert-backed articles, nutritional science, and hormonal insights to help you manage and reverse diabetes effectively.",
      trendingTopic: "The HbA1c Reversal Protocol 2026"
    };

    if (!latestBlog) {
      return res.status(200).json({
        success: 1,
        message: "No blogs found, returning default configurations",
        data: defaultHero
      });
    }

    return res.status(200).json({
      success: 1,
      message: "Blog Hero content fetched successfully",
      data: {
        badgeText: latestBlog.badgeText || defaultHero.badgeText,
        headlinePart1: latestBlog.headlinePart1 || defaultHero.headlinePart1,
        headlinePart2: latestBlog.headlinePart2 || defaultHero.headlinePart2,
        subheadline: latestBlog.subheadline || defaultHero.subheadline,
        trendingTopic: latestBlog.trendingTopic || defaultHero.trendingTopic
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

module.exports = {
  createBlog,
  updateBlog,
  deleteBlog,
  getAdminBlogs,
  getUserBlogs,
  getParticularBlog,
  updateBlogHero,
  getBlogHero
};