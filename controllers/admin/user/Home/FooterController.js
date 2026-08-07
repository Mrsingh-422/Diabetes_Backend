const SiteContent = require("../../../../models/Footer");

// Helper to normalize backslashes to forward slashes and ensure clean path paths
const normalizePath = (pathString) => {
  if (!pathString || typeof pathString !== 'string') return "";
  return pathString.replace(/\\/g, '/');
};

// ==========================================
// POLICY CONTROLLERS
// ==========================================

// 1. Create Policy (Privacy + Terms)
const createPolicy = async (req, res) => {
  try {
    const { privacyPolicy, termsAndConditions } = req.body;

    const data = {
      privacyPolicy: privacyPolicy || "",
      termsAndConditions: termsAndConditions || ""
    };

    const newData = await SiteContent.create(data);

    return res.status(201).json({
      success: 1,
      message: "Policy created successfully",
      data: newData
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 2. Get Policy Details
const getPolicy = async (req, res) => {
  try {
    const content = await SiteContent.findOne();
    return res.status(200).json({
      success: 1,
      data: {
        privacyPolicy: content?.privacyPolicy || "",
        termsAndConditions: content?.termsAndConditions || ""
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 3. Update Policy Content
const updatePolicy = async (req, res) => {
  try {
    const { privacyPolicy, termsAndConditions } = req.body;

    const updateData = {};
    if (privacyPolicy !== undefined) updateData.privacyPolicy = privacyPolicy;
    if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;

    const updated = await SiteContent.findOneAndUpdate(
      {},
      updateData,
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: 1,
      message: "Policy updated successfully",
      data: updated
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// ==========================================
// FOOTER CONTENT CONTROLLERS
// ==========================================

// 4. Create Footer Sections
const createContent = async (req, res) => {
  try {
    const files = req.files || {};

    const data = {
      easyHeading: req.body.easyHeading || "",
      easyContent: req.body.easyContent || "",
      easyIcon: files.easyIcon ? `/uploads/user/footer/${files.easyIcon[0].filename}` : "",

      affordableHeading: req.body.affordableHeading || "",
      affordableContent: req.body.affordableContent || "",
      affordableIcon: files.affordableIcon ? `/uploads/user/footer/${files.affordableIcon[0].filename}` : "",

      accessibleHeading: req.body.accessibleHeading || "",
      accessibleContent: req.body.accessibleContent || "",
      accessibleIcon: files.accessibleIcon ? `/uploads/user/footer/${files.accessibleIcon[0].filename}` : ""
    };

    const content = await SiteContent.create(data);

    return res.status(201).json({
      success: 1,
      message: "Footer content created successfully",
      data: content
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 5. Get Footer Sections
const getContent = async (req, res) => {
  try {
    const content = await SiteContent.findOne();

    if (!content) {
      return res.status(200).json({
        success: 1,
        data: null
      });
    }

    return res.status(200).json({
      success: 1,
      data: content
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 6. Update Footer Sections
const updateContent = async (req, res) => {
  try {
    const files = req.files || {};
    const { id } = req.params;

    const updateData = {
      easyHeading: req.body.easyHeading,
      easyContent: req.body.easyContent,
      affordableHeading: req.body.affordableHeading,
      affordableContent: req.body.affordableContent,
      accessibleHeading: req.body.accessibleHeading,
      accessibleContent: req.body.accessibleContent
    };

    if (files.easyIcon) {
      updateData.easyIcon = `/uploads/user/footer/${files.easyIcon[0].filename}`;
    }
    if (files.affordableIcon) {
      updateData.affordableIcon = `/uploads/user/footer/${files.affordableIcon[0].filename}`;
    }
    if (files.accessibleIcon) {
      updateData.accessibleIcon = `/uploads/user/footer/${files.accessibleIcon[0].filename}`;
    }

    const updated = await SiteContent.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: 0,
        message: "Footer content not found"
      });
    }

    return res.status(200).json({
      success: 1,
      message: "Footer content updated successfully",
      data: updated
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  createPolicy,
  getPolicy,
  updatePolicy,
  createContent,
  getContent,
  updateContent
};