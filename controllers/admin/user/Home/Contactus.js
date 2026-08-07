const Contact = require("../../../../models/ContactUs");

// ==========================================
// CONTROLLERS
// ==========================================

// 1. POST - Add / Initialize Contact Details
const addContact = async (req, res) => {
  try {
    const contactData = {
      email: req.body.email || "",
      phone: req.body.phone || "",
      registeredAddress: req.body.registeredAddress || "",
      postalAddress: req.body.postalAddress || "",
      facebookLink: req.body.facebookLink || "",
      instaLink: req.body.instaLink || "",
      youtubeLink: req.body.youtubeLink || "",
      twitterLink: req.body.twitterLink || "",
      linkedinLink: req.body.linkedinLink || "",
      androidAppLink: req.body.androidAppLink || "",
      iosAppleLink: req.body.iosAppleLink || ""
    };

    const contact = await Contact.create(contactData);

    return res.status(201).json({
      success: 1,
      message: "Contact details created successfully",
      data: contact
    });
  } catch (error) {
    return res.status(400).json({
      success: 0,
      message: error.message
    });
  }
};

// 2. GET - Retrieve Contact Details (Admin & User)
const getContact = async (req, res) => {
  try {
    const contact = await Contact.findOne();

    if (!contact) {
      return res.status(200).json({
        success: 1,
        message: "No contact details initialized yet.",
        data: null
      });
    }

    return res.status(200).json({
      success: 1,
      message: "Contact details fetched successfully",
      data: contact
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// 3. PUT - Update Contact Details (Includes Upsert Protection)
const updateContact = async (req, res) => {
  try {
    const updateData = {
      email: req.body.email,
      phone: req.body.phone,
      registeredAddress: req.body.registeredAddress,
      postalAddress: req.body.postalAddress,
      facebookLink: req.body.facebookLink,
      instaLink: req.body.instaLink,
      youtubeLink: req.body.youtubeLink,
      twitterLink: req.body.twitterLink,
      linkedinLink: req.body.linkedinLink,
      androidAppLink: req.body.androidAppLink,
      iosAppleLink: req.body.iosAppleLink
    };

    // Clean up undefined parameters before updating
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Find and update the document, or create one if none exist (upsert)
    const updatedContact = await Contact.findOneAndUpdate(
      {},
      updateData,
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: 1,
      message: "Contact details updated successfully",
      data: updatedContact
    });
  } catch (error) {
    return res.status(500).json({
      success: 0,
      message: error.message
    });
  }
};

// ==========================================
// MODULE EXPORTS
// ==========================================
module.exports = {
  addContact,
  getContact,
  updateContact
};