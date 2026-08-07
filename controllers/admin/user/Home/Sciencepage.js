const SciencePage = require("../../../../models/science");

// Helper to safely parse JSON strings if sent from multipart forms
const parseJsonField = (data) => {
  if (!data) return undefined;
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    return undefined;
  }
};

// ==========================================
// PUBLIC CONTROLLERS
// ==========================================

// 1. Fetch Science Page Content
const getSciencePage = async (req, res) => {
  try {
    // Added populate for the public fetch route
    let sciencePage = await SciencePage.findOne({ isActive: true })
      .populate("lastUpdatedBy", "name");

    if (!sciencePage) {
      // Initialize with structured default data on first load
      sciencePage = await SciencePage.create({
        heroTitle: "Advancing Diabetes Research",
        heroSubtitle: "Transforming lives through innovative science and research",
        impactTitle: "Our Impact",
        grantTitle: "Research Grants",
        grantSubtitle: "Supporting groundbreaking diabetes research",
        researchTitle: "Latest Research",
        researchDescription: "Explore our latest findings and breakthroughs",
        statsTitle: "Clinical Results",
        isActive: true,
        impactCards: [
          {
            image: "https://www.diabetesaustralia.com.au/wp-content/uploads/2022_da_wdd_icon_numbers_australia_1.0.svg",
            number: "1,500,000",
            description: "People living with diabetes in Australia."
          },
          {
            image: "https://www.diabetesaustralia.com.au/wp-content/uploads/Prevention.png",
            number: "120,000",
            description: "People diagnosed with diabetes each year."
          }
        ],
        teamCards: [
          {
            name: "Michael German, M.D.",
            institution: "University of California, San Francisco"
          }
        ],
        statistics: [
          {
            percentage: "51.9%",
            description: "Reduction in hypoglycemia incident post counselling",
            source: "Advanced Technologies & Treatments for Diabetes"
          }
        ]
      });

      // Populate after creation
      await sciencePage.populate("lastUpdatedBy", "name");
    }

    return res.status(200).json({
      success: 1,
      message: "Science page content fetched successfully",
      data: sciencePage
    });
  } catch (error) {
    console.error("Error fetching science page:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// ==========================================
// ADMIN CONTROLLERS (Protected)
// ==========================================

// 2. Update Science Page Content
const updateSciencePage = async (req, res) => {
  try {
    const updateData = req.body;

    let sciencePage = await SciencePage.findOne({ isActive: true });

    if (!sciencePage) {
      sciencePage = await SciencePage.create({
        isActive: true,
        impactCards: [],
        teamCards: [],
        statistics: [],
        researchImages: []
      });
    }

    // List of scalar strings to update directly
    const fieldsToUpdate = [
      'heroTitle', 'heroSubtitle', 'impactTitle', 'grantTitle', 
      'grantSubtitle', 'researchTitle', 'researchDescription', 'statsTitle'
    ];

    fieldsToUpdate.forEach(field => {
      if (updateData[field] !== undefined) {
        sciencePage[field] = updateData[field];
      }
    });

    // Handle parsed Array updates if sent directly
    const parsedImpactCards = parseJsonField(updateData.impactCards);
    if (parsedImpactCards && Array.isArray(parsedImpactCards)) {
      sciencePage.impactCards = parsedImpactCards;
    }

    const parsedTeamCards = parseJsonField(updateData.teamCards);
    if (parsedTeamCards && Array.isArray(parsedTeamCards)) {
      sciencePage.teamCards = parsedTeamCards;
    }

    const parsedStatistics = parseJsonField(updateData.statistics);
    if (parsedStatistics && Array.isArray(parsedStatistics)) {
      sciencePage.statistics = parsedStatistics;
    }

    const parsedResearchImages = parseJsonField(updateData.researchImages);
    if (parsedResearchImages && Array.isArray(parsedResearchImages)) {
      sciencePage.researchImages = parsedResearchImages;
    }

    // Handle singular nested card updates via index
    if (updateData.impactCard) {
      const card = parseJsonField(updateData.impactCard);
      if (card && card.index !== undefined && sciencePage.impactCards[card.index]) {
        Object.keys(card).forEach(key => {
          if (key !== 'index') sciencePage.impactCards[card.index][key] = card[key];
        });
      }
    }

    if (updateData.teamCard) {
      const card = parseJsonField(updateData.teamCard);
      if (card && card.index !== undefined && sciencePage.teamCards[card.index]) {
        Object.keys(card).forEach(key => {
          if (key !== 'index') sciencePage.teamCards[card.index][key] = card[key];
        });
      }
    }

    if (updateData.statistic) {
      const stat = parseJsonField(updateData.statistic);
      if (stat && stat.index !== undefined && sciencePage.statistics[stat.index]) {
        Object.keys(stat).forEach(key => {
          if (key !== 'index') sciencePage.statistics[stat.index][key] = stat[key];
        });
      }
    }

    // Handle Multipart Image Uploads with formatted folder paths
    if (req.files) {
      if (req.files.heroBackgroundImage) {
        sciencePage.heroBackgroundImage = `/uploads/science/${req.files.heroBackgroundImage[0].filename}`;
      }
      if (req.files.grantBackgroundImage) {
        sciencePage.grantBackgroundImage = `/uploads/science/${req.files.grantBackgroundImage[0].filename}`;
      }
      if (req.files.researchImages) {
        const newResearchImages = req.files.researchImages.map(file => `/uploads/science/${file.filename}`);
        sciencePage.researchImages = [...sciencePage.researchImages, ...newResearchImages];
      }
    }

    sciencePage.lastUpdatedBy = req.user._id;
    await sciencePage.save();

    // Populate the newly updated document before returning response
    await sciencePage.populate("lastUpdatedBy", "name");

    return res.status(200).json({
      success: 1,
      message: "Science page updated successfully",
      data: sciencePage
    });
  } catch (error) {
    console.error("Error updating science page:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 3. Add Item dynamically (impactCard / teamCard / statistic)
const addSciencePageItem = async (req, res) => {
  try {
    const { type, data } = req.body;

    let sciencePage = await SciencePage.findOne({ isActive: true });

    if (!sciencePage) {
      return res.status(404).json({
        success: 0,
        message: "No active science page found."
      });
    }

    const itemData = parseJsonField(data) || data;

    switch (type) {
      case 'impactCard':
        sciencePage.impactCards.push(itemData);
        break;
      case 'teamCard':
        sciencePage.teamCards.push(itemData);
        break;
      case 'statistic':
        sciencePage.statistics.push(itemData);
        break;
      default:
        return res.status(400).json({
          success: 0,
          message: "Invalid type. Allowed values are: 'impactCard', 'teamCard', or 'statistic'"
        });
    }

    sciencePage.lastUpdatedBy = req.user._id;
    await sciencePage.save();

    // Populate after array update
    await sciencePage.populate("lastUpdatedBy", "name");

    return res.status(200).json({
      success: 1,
      message: `${type} added successfully`,
      data: sciencePage
    });
  } catch (error) {
    console.error("Error adding science page item:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 4. Remove Item dynamically by Index
const removeSciencePageItem = async (req, res) => {
  try {
    const { type, index } = req.body;

    let sciencePage = await SciencePage.findOne({ isActive: true });

    if (!sciencePage) {
      return res.status(404).json({
        success: 0,
        message: "No active science page found."
      });
    }

    const itemIndex = parseInt(index);

    switch (type) {
      case 'impactCard':
        if (sciencePage.impactCards[itemIndex] !== undefined) {
          sciencePage.impactCards.splice(itemIndex, 1);
        } else {
          return res.status(400).json({ success: 0, message: "Invalid index for impactCard" });
        }
        break;
      case 'teamCard':
        if (sciencePage.teamCards[itemIndex] !== undefined) {
          sciencePage.teamCards.splice(itemIndex, 1);
        } else {
          return res.status(400).json({ success: 0, message: "Invalid index for teamCard" });
        }
        break;
      case 'statistic':
        if (sciencePage.statistics[itemIndex] !== undefined) {
          sciencePage.statistics.splice(itemIndex, 1);
        } else {
          return res.status(400).json({ success: 0, message: "Invalid index for statistic" });
        }
        break;
      default:
        return res.status(400).json({
          success: 0,
          message: "Invalid type. Use 'impactCard', 'teamCard', or 'statistic'"
        });
    }

    sciencePage.lastUpdatedBy = req.user._id;
    await sciencePage.save();

    // Populate after removing item
    await sciencePage.populate("lastUpdatedBy", "name");

    return res.status(200).json({
      success: 1,
      message: `${type} removed successfully`,
      data: sciencePage
    });
  } catch (error) {
    console.error("Error removing science page item:", error);
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 5. Separate Upload endpoint for Science Images
const uploadScienceImages = async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: 0,
        message: "No files were uploaded."
      });
    }

    const uploadedFiles = [];

    if (req.files.heroBackgroundImage) {
      uploadedFiles.push({
        type: 'heroBackgroundImage',
        path: `/uploads/science/${req.files.heroBackgroundImage[0].filename}`
      });
    }

    if (req.files.grantBackgroundImage) {
      uploadedFiles.push({
        type: 'grantBackgroundImage',
        path: `/uploads/science/${req.files.grantBackgroundImage[0].filename}`
      });
    }

    if (req.files.researchImages) {
      req.files.researchImages.forEach(file => {
        uploadedFiles.push({
          type: 'researchImage',
          path: `/uploads/science/${file.filename}`
        });
      });
    }

    return res.status(200).json({
      success: 1,
      message: "Images uploaded successfully",
      data: uploadedFiles
    });
  } catch (error) {
    console.error("Error uploading science images:", error);
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
  getSciencePage,
  updateSciencePage,
  addSciencePageItem,
  removeSciencePageItem,
  uploadScienceImages
};