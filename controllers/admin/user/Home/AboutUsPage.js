const AboutUs = require("../../../../models/AboutUs");

// Helper to safely parse JSON strings if sent from multipart forms
const parseJsonField = (data, field) => {
  if (data[field] && typeof data[field] === 'string') {
    try {
      return JSON.parse(data[field]);
    } catch (error) {
      console.error(`Failed to parse field ${field}:`, error);
      return data[field];
    }
  }
  return data[field];
};

// ==========================================
// PUBLIC & ADMIN CONTROLLERS
// ==========================================

// 1. GET - Retrieve About Us Data
const getAboutUs = async (req, res) => {
  try {
    let aboutUs = await AboutUs.findOne({ isActive: true })
      .populate("lastUpdatedBy", "name");
    
    if (!aboutUs) {
      // Create and initialize default structured data if none exists
      aboutUs = await AboutUs.create({
        heroTitle: "About Us",
        mainTitle: "We Provide Finest Patient's Care & Amenities",
        leftFeatures: [
          "Seamless Care",
          "Warm and Welcoming Environment",
          "Comprehensive Care",
          "Expert Doctors"
        ],
        rightFeatures: [
          "Patient-Centered Care",
          "Personalized Approach",
          "Cutting-Edge Technology",
          "Positive Reviews"
        ],
        priorityStatement: "YOUR HEALTH IS OUR TOP PRIORITY",
        stats: {
          patientReviews: "5k+",
          googleRating: "4.9"
        },
        moreAboutTitle: "We Are A Clinic, Provide Excellence In Personalized Care",
        cards: [
          {
            title: "Not Just Better Care, But A Better Experience",
            description: "At our medical center, we believe in providing not just better care but a better experience overall.",
            image: "https://themes.hibootstrap.com/hospa/wp-content/uploads/2024/03/img1.png",
            backgroundColor: "#ffffff"
          }
        ],
        missionVision: [
          {
            type: "mission",
            title: "OUR MISSION",
            description: "Our mission is to care for our patients and their families when it matters most.",
            icon: "fa-shield",
            backgroundColor: "#9d99b6"
          }
        ],
        insuranceTitle: "Our Accepted Insurance",
        insuranceLogos: [
          "https://themes.hibootstrap.com/hospa/wp-content/uploads/2024/04/partner1.png"
        ]
      });

      await aboutUs.populate("lastUpdatedBy", "name");
    }

    return res.status(200).json({
      success: 1,
      message: "About Us data fetched successfully",
      data: aboutUs
    });
  } catch (error) {
    console.error("Error fetching About Us:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 2. PUT - Update About Us Content
const updateAboutUs = async (req, res) => {
  try {
    const updateData = { ...req.body };
    const files = req.files;

    // Standardize and parse incoming dynamic array/object payloads
    updateData.leftFeatures = parseJsonField(updateData, 'leftFeatures');
    updateData.rightFeatures = parseJsonField(updateData, 'rightFeatures');
    updateData.cards = parseJsonField(updateData, 'cards');
    updateData.missionVision = parseJsonField(updateData, 'missionVision');
    updateData.insuranceLogos = parseJsonField(updateData, 'insuranceLogos');
    updateData.stats = parseJsonField(updateData, 'stats');

    // Handle Multipart Image Uploads with clean formatting
    if (files) {
      if (files.heroImage) {
        updateData.heroImage = `/uploads/aboutus/${files.heroImage[0].filename}`;
      }
      if (files.mainImage) {
        updateData.mainImage = `/uploads/aboutus/${files.mainImage[0].filename}`;
      }
      if (files.moreAboutImage) {
        updateData.moreAboutImage = `/uploads/aboutus/${files.moreAboutImage[0].filename}`;
      }
      if (files.moreAboutSideImage) {
        updateData.moreAboutSideImage = `/uploads/aboutus/${files.moreAboutSideImage[0].filename}`;
      }
      
      // Map multiple card images dynamically based on index array representation
      if (files.cardImages && updateData.cards && Array.isArray(updateData.cards)) {
        files.cardImages.forEach((file, index) => {
          if (updateData.cards[index]) {
            updateData.cards[index].image = `/uploads/aboutus/${file.filename}`;
          }
        });
      }
      
      // Map insurance logo path arrays
      if (files.insuranceLogos) {
        updateData.insuranceLogos = files.insuranceLogos.map(file => 
          `/uploads/aboutus/${file.filename}`
        );
      }
    }

    let aboutUs = await AboutUs.findOne({ isActive: true });
    const adminId = req.user ? req.user._id : null;
    
    if (aboutUs) {
      aboutUs = await AboutUs.findByIdAndUpdate(
        aboutUs._id,
        { 
          ...updateData, 
          lastUpdatedBy: adminId 
        },
        { new: true, runValidators: true }
      );
    } else {
      aboutUs = await AboutUs.create({
        ...updateData,
        lastUpdatedBy: adminId
      });
    }

    await aboutUs.populate("lastUpdatedBy", "name");

    return res.status(200).json({
      success: 1,
      message: "About Us updated successfully",
      data: aboutUs
    });
  } catch (error) {
    console.error("Error updating About Us:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 3. POST - Upload Single Image Separately
const uploadImage = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files.image ? req.files.image[0] : null);

    if (!file) {
      return res.status(400).json({
        success: 0,
        message: "No file uploaded"
      });
    }

    const imageUrl = `/uploads/aboutus/${file.filename}`;

    return res.status(200).json({
      success: 1,
      message: "Image uploaded successfully",
      data: {
        imageUrl: imageUrl
      }
    });
  } catch (error) {
    console.error("Error uploading image:", error);
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
  getAboutUs,
  updateAboutUs,
  uploadImage
};