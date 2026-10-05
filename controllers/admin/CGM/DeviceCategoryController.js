const DeviceCategory = require('../../../models/DeviceCategory');
const CGMDevices = require('../../../models/CGMDevicesModel');

// 1. Create Category
const createDeviceCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: "Category name is required." });
        }

        const exists = await DeviceCategory.findOne({ name: name.trim() });
        if (exists) {
            return res.status(400).json({ success: false, message: "Category with this name already exists." });
        }

        const category = await DeviceCategory.create({
            name: name.trim(),
            description: description || ""
        });

        res.status(201).json({
            success: true,
            message: "Device category created successfully!",
            data: category
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Get All Categories (For Admin table & Dropdown)
const getDeviceCategories = async (req, res) => {
    try {
        const categories = await DeviceCategory.find().sort({ createdAt: -1 });

        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Update Category
const updateDeviceCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description;

        const category = await DeviceCategory.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }

        res.json({
            success: true,
            message: "Category updated successfully!",
            data: category
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Delete Category
const deleteDeviceCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await DeviceCategory.findByIdAndDelete(id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }

        // Associated devices se category unassign karein
        await CGMDevices.updateMany({ categoryId: id }, { $set: { categoryId: null } });

        res.json({
            success: true,
            message: "Category deleted successfully and associated items updated."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Toggle Category Status Switch
const toggleCategoryStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const category = await DeviceCategory.findById(id);

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }

        category.isActive = !category.isActive;
        await category.save();

        res.json({
            success: true,
            message: `Category is now ${category.isActive ? 'Active' : 'Inactive'}`,
            data: category
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createDeviceCategory,
    getDeviceCategories,
    updateDeviceCategory,
    deleteDeviceCategory,
    toggleCategoryStatus
};