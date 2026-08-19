// controllers/admin/Food/FoodCategory.js

const FoodCategory = require('../../../models/FoodCategory');
const FoodService = require('../../../models/FoodService');

// --- 1. ADD NEW FOOD CATEGORY ---
const createFoodCategory = async (req, res) => {
    try {
        const { foodCategory, foodEffectCategory } = req.body;

        // Simply create the record without any unique restrictions
        const category = await FoodCategory.create({
            foodCategory: foodCategory || null,
            foodEffectCategory: foodEffectCategory || null
        });

        res.status(201).json({
            success: true,
            message: "Category added successfully to directory!",
            data: category
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. RETRIEVE ALL FOOD CATEGORIES ---
const getFoodCategories = async (req, res) => {
    try {
        const categories = await FoodCategory.find().sort({ createdAt: -1 });

        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. UPDATE CATEGORY DETAILS ---
const updateFoodCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { foodCategory, foodEffectCategory } = req.body;

        const updateFields = {};
        if (foodCategory !== undefined) updateFields.foodCategory = foodCategory;
        if (foodEffectCategory !== undefined) updateFields.foodEffectCategory = foodEffectCategory;

        const category = await FoodCategory.findByIdAndUpdate(
            id,
            { $set: updateFields },
            { new: true, runValidators: true }
        );

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }

        res.json({
            success: true,
            message: "Category details updated successfully!",
            data: category
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. DELETE CATEGORY ---
const deleteFoodCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await FoodCategory.findByIdAndDelete(id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }

        // Relational Integrity check
        await FoodService.updateMany(
            { categoryId: id },
            { $set: { categoryId: null } }
        );

        res.json({
            success: true,
            message: "Category removed successfully and associated items updated to Uncategorized."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createFoodCategory,
    getFoodCategories,
    updateFoodCategory,
    deleteFoodCategory
};