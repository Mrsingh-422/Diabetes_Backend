// controllers/admin/CGM/CGMAddonAdminController.js

const CGMAddon = require('../../../models/CGMAddon');
const { deleteFile } = require('../../../utils/fileHandler');

// Helper to remove old image file
const removeOldFile = (filePath) => {
    if (!filePath) return;
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const publicPath = cleanPath.startsWith('public') ? cleanPath : `public/${cleanPath}`;
    deleteFile(publicPath);
};

// 1. Create Add-on Item (Without coachCharge in response)
const createCGMAddon = async (req, res) => {
    try {
        const { name, price, description } = req.body;

        if (!name || price === undefined) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ success: false, message: "Addon name and price are required." });
        }

        const imageUrl = req.file ? `/uploads/cgm_addons/${req.file.filename}` : null;

        const addon = await CGMAddon.create({
            name: name.trim(),
            price: Number(price) || 0,
            coachCharge: 0,
            description: description || "",
            imageUrl,
            isActive: true
        });

        res.status(201).json({
            success: true,
            message: "CGM Add-on item created successfully!",
            data: {
                _id: addon._id,
                name: addon.name,
                price: addon.price,
                description: addon.description,
                imageUrl: addon.imageUrl,
                isActive: addon.isActive,
                createdAt: addon.createdAt,
                updatedAt: addon.updatedAt
            }
        });
    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Get All Add-on Items
const getCGMAddons = async (req, res) => {
    try {
        const { activeOnly } = req.query;
        const filter = { coachCharge: 0 };

        if (activeOnly === 'true') filter.isActive = true;

        const addons = await CGMAddon.find(filter)
            .select('-coachCharge -__v')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: addons.length,
            data: addons
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Get Single Add-on By ID
const getCGMAddonById = async (req, res) => {
    try {
        const { id } = req.params;
        const addon = await CGMAddon.findById(id).select('-coachCharge -__v');

        if (!addon) {
            return res.status(404).json({ success: false, message: "Addon item not found." });
        }

        res.json({ success: true, data: addon });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Update Add-on Item
const updateCGMAddon = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, description } = req.body;

        const addon = await CGMAddon.findById(id);
        if (!addon) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(404).json({ success: false, message: "Addon item not found." });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (price !== undefined) updateData.price = Number(price);
        if (description !== undefined) updateData.description = description;

        if (req.file) {
            if (addon.imageUrl) removeOldFile(addon.imageUrl);
            updateData.imageUrl = `/uploads/cgm_addons/${req.file.filename}`;
        }

        const updated = await CGMAddon.findByIdAndUpdate(
            id, 
            { $set: updateData }, 
            { new: true }
        ).select('-coachCharge -__v');

        res.json({
            success: true,
            message: "Add-on item updated successfully!",
            data: updated
        });
    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Delete Add-on Item
const deleteCGMAddon = async (req, res) => {
    try {
        const { id } = req.params;
        const addon = await CGMAddon.findById(id);

        if (!addon) {
            return res.status(404).json({ success: false, message: "Addon item not found." });
        }

        if (addon.imageUrl) removeOldFile(addon.imageUrl);
        await CGMAddon.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "Add-on item and image deleted permanently."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. Toggle Add-on Status
const toggleCGMAddonActive = async (req, res) => {
    try {
        const { id } = req.params;
        const addon = await CGMAddon.findById(id);

        if (!addon) {
            return res.status(404).json({ success: false, message: "Addon item not found." });
        }

        addon.isActive = !addon.isActive;
        await addon.save();

        res.json({
            success: true,
            message: `Add-on item is now ${addon.isActive ? 'Active' : 'Inactive'}`,
            data: {
                _id: addon._id,
                name: addon.name,
                price: addon.price,
                description: addon.description,
                imageUrl: addon.imageUrl,
                isActive: addon.isActive,
                updatedAt: addon.updatedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCGMAddon,
    getCGMAddons,
    getCGMAddonById,
    updateCGMAddon,
    deleteCGMAddon,
    toggleCGMAddonActive
};