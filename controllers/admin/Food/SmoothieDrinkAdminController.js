// controllers/admin/Food/SmoothieDrinkAdminController.js

const smoothiDrinks = require('../../../models/smoothiDrinks');
const { deleteFile } = require('../../../utils/fileHandler');
const mongoose = require('mongoose');

// Helper to safely parse strings into arrays of strings
const parseStringToArray = (field) => {
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
        try {
            const parsed = JSON.parse(field);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            return field.split(',').map(item => item.trim()).filter(Boolean);
        }
    }
    return [];
};

// Helper to parse ingredients object array
const parseIngredients = (field) => {
    if (!field) return [];
    let parsed = field;

    if (typeof field === 'string') {
        try {
            parsed = JSON.parse(field);
        } catch (e) {
            return field.split(',').map(item => ({
                name: item.trim(),
                quantity: "",
                calories: 0
            })).filter(i => Boolean(i.name));
        }
    }

    if (Array.isArray(parsed)) {
        return parsed.map(item => {
            if (typeof item === 'string') {
                return { name: item.trim(), quantity: "", calories: 0 };
            }
            return {
                name: item.name ? String(item.name).trim() : "",
                quantity: item.quantity ? String(item.quantity).trim() : "",
                calories: Number(item.calories) || 0
            };
        }).filter(i => Boolean(i.name));
    }

    return [];
};

// ==========================================
// 🥤 1. CREATE SMOOTHIE / DRINK (WITH AUTO-SUM CALORIES & MULTIPLE IMAGES)
// Full Path: POST /admin/food/drinks/add
// ==========================================
const createSmoothieDrink = async (req, res) => {
    try {
        const { price, discountPrice, ingredients, tags, dietType, calories, name, description, foodEffectCategory } = req.body;

        if (!name || !description || price === undefined || !foodEffectCategory) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide all required fields: name, description, price, foodEffectCategory." 
            });
        }

        // Validation: discountPrice <= price
        if (discountPrice !== undefined && Number(discountPrice) > Number(price)) {
            return res.status(400).json({ success: false, message: "Discount price cannot be greater than the original price." });
        }

        // 1. Handle Multiple Uploaded Images
        let imagesList = [];
        if (req.files && req.files.images && req.files.images.length > 0) {
            imagesList = req.files.images.map(file => `/uploads/foods/drinks/${file.filename}`);
        }

        // 2. Parse Ingredients & Auto-Calculate Total Calories
        const parsedIngredients = parseIngredients(ingredients);
        const parsedTags = parseStringToArray(tags);

        const sumIngredientCalories = parsedIngredients.reduce((total, item) => total + (Number(item.calories) || 0), 0);
        const finalTotalCalories = sumIngredientCalories > 0 ? sumIngredientCalories : (Number(calories) || 0);

        let normalizedDietType = dietType || 'Vegan';
        if (dietType === 'Non-Veg') normalizedDietType = 'Non Veg';

        const newDrink = await smoothiDrinks.create({
            ...req.body,
            dietType: normalizedDietType,
            ingredients: parsedIngredients,
            calories: finalTotalCalories,
            tags: parsedTags,
            images: imagesList,
            isPopular: req.body.isPopular === 'true' || req.body.isPopular === true,
            isRecommended: req.body.isRecommended === 'true' || req.body.isRecommended === true
        });

        res.status(201).json({
            success: true,
            message: `Smoothie/Drink '${newDrink.name}' added successfully! (Total Calories: ${finalTotalCalories} kcal)`,
            data: newDrink
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🥤 2. GET ALL SMOOTHIE DRINKS (WITH SEARCH & FILTERS)
// Full Path: GET /admin/food/drinks/get
// ==========================================
const getAllSmoothieDrinks = async (req, res) => {
    try {
        const { search, drinkType, dietType, foodEffectCategory, categoryId, page = 1, limit = 20 } = req.query;
        const query = { isActive: true };

        if (categoryId) query.categoryId = categoryId;
        if (drinkType) query.drinkType = drinkType;
        if (dietType) query.dietType = dietType;
        if (foodEffectCategory) query.foodEffectCategory = new RegExp(`^${foodEffectCategory.trim()}$`, 'i');

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { description: regex },
                { "ingredients.name": regex },
                { tags: regex },
                { foodEffectCategory: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await smoothiDrinks.countDocuments(query);

        const drinks = await smoothiDrinks.find(query)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            count: drinks.length,
            data: drinks
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 3. GET SINGLE SMOOTHIE DRINK DETAILS BY ID
// Full Path: GET /admin/food/drinks/get/:id
// ==========================================
const getSmoothieDrinkById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID format." });
        }

        const drink = await smoothiDrinks.findById(id)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item not found." });
        }

        res.json({
            success: true,
            data: drink
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ✏️ 4. UPDATE SMOOTHIE DRINK (WITH MULTI-IMAGE & CALORIE RE-CALCULATION)
// Full Path: PUT /admin/food/drinks/update/:id
// ==========================================
const updateSmoothieDrink = async (req, res) => {
    try {
        const { id } = req.params;
        const { price, discountPrice, ingredients, tags, dietType, calories } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID format." });
        }

        const drink = await smoothiDrinks.findById(id);
        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item not found." });
        }

        if (price !== undefined && discountPrice !== undefined) {
            if (Number(discountPrice) > Number(price)) {
                return res.status(400).json({ success: false, message: "Discount price cannot exceed the original price." });
            }
        }

        const updateData = { ...req.body };

        // 1. Ingredients & Calories Re-calculation
        if (ingredients !== undefined) {
            const parsedIngredients = parseIngredients(ingredients);
            updateData.ingredients = parsedIngredients;

            const sumIngredientCalories = parsedIngredients.reduce((total, ing) => total + (Number(ing.calories) || 0), 0);
            if (sumIngredientCalories > 0) {
                updateData.calories = sumIngredientCalories;
            } else if (calories !== undefined) {
                updateData.calories = Number(calories);
            }
        } else if (calories !== undefined) {
            updateData.calories = Number(calories);
        }

        if (tags !== undefined) updateData.tags = parseStringToArray(tags);
        if (dietType !== undefined) updateData.dietType = dietType === 'Non-Veg' ? 'Non Veg' : dietType;

        // 2. Handle Multiple Images Replacement
        if (req.files && req.files.images && req.files.images.length > 0) {
            // Delete old images from storage
            if (Array.isArray(drink.images) && drink.images.length > 0) {
                drink.images.forEach(img => deleteFile(img));
            }

            updateData.images = req.files.images.map(file => `/uploads/foods/drinks/${file.filename}`);
        }

        const updatedDrink = await smoothiDrinks.findByIdAndUpdate(id, { $set: updateData }, { new: true })
            .populate('categoryId', 'foodCategory foodEffectCategory');

        res.json({
            success: true,
            message: "Smoothie/Drink details updated successfully!",
            data: updatedDrink
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🗑️ 5. DELETE SMOOTHIE DRINK
// Full Path: DELETE /admin/food/drinks/delete/:id
// ==========================================
const deleteSmoothieDrink = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID format." });
        }

        const drink = await smoothiDrinks.findById(id);
        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item not found." });
        }

        // Delete associated images from storage
        if (Array.isArray(drink.images) && drink.images.length > 0) {
            drink.images.forEach(img => deleteFile(img));
        }

        await smoothiDrinks.findByIdAndDelete(id);

        res.json({
            success: true,
            message: `Smoothie/Drink '${drink.name}' removed successfully along with images.`
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ⚡ 6. TOGGLE DRINK AVAILABILITY STATUS
// Full Path: PATCH /admin/food/drinks/toggle-status/:id
// ==========================================
const toggleSmoothieDrinkStatus = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Drink ID format." });
        }

        const drink = await smoothiDrinks.findById(id);
        if (!drink) {
            return res.status(404).json({ success: false, message: "Smoothie/Drink item not found." });
        }

        drink.isActive = !drink.isActive;
        await drink.save();

        res.json({
            success: true,
            message: `Drink status updated. Currently ${drink.isActive ? 'Active' : 'Inactive'}`,
            isActive: drink.isActive,
            data: drink
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createSmoothieDrink,
    getAllSmoothieDrinks,
    getSmoothieDrinkById,
    updateSmoothieDrink,
    deleteSmoothieDrink,
    toggleSmoothieDrinkStatus
};