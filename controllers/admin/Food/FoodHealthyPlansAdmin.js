// controllers/admin/Food/FoodHealthyPlansAdmin.js

const FoodHealthyPlans = require('../../../models/FoodHealthyPlans');
const FoodHealthyCategory = require('../../../models/FoodHealthyCategory');
const FoodService = require('../../../models/FoodService');
const { deleteFile } = require('../../../utils/fileHandler');
const mongoose = require('mongoose');

// Helper to safely parse JSON strings or comma-separated values into arrays
const parseArray = (field) => {
    if (!field) return [];
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

// ==========================================
// 🏷️ 1. CATEGORY & SUBCATEGORY CRUD OPERATIONS
// ==========================================

// Add or Upsert Main Category & Subcategories
const createOrUpdateHealthyCategory = async (req, res) => {
    try {
        const { mainCategory, subCategories = [] } = req.body;

        if (!mainCategory) {
            return res.status(400).json({ success: false, message: "mainCategory (e.g., 'Men', 'Women', 'Child', 'Old') is required." });
        }

        const normalizedMain = mainCategory.trim();
        const parsedSubCategories = Array.isArray(subCategories) ? subCategories : parseArray(subCategories);

        let category = await FoodHealthyCategory.findOne({ mainCategory: new RegExp(`^${normalizedMain}$`, 'i') });

        if (category) {
            // Append new subcategories without duplicates
            parsedSubCategories.forEach(sub => {
                const subName = typeof sub === 'string' ? sub.trim() : sub.name?.trim();
                const exists = category.subCategories.some(s => s.name.toLowerCase() === subName.toLowerCase());
                if (!exists && subName) {
                    category.subCategories.push(typeof sub === 'object' ? sub : { name: subName });
                }
            });
            await category.save();
        } else {
            category = await FoodHealthyCategory.create({
                mainCategory: normalizedMain,
                subCategories: parsedSubCategories.map(s => typeof s === 'string' ? { name: s.trim() } : s)
            });
        }

        res.status(201).json({
            success: true,
            message: `Healthy program category '${normalizedMain}' saved successfully!`,
            data: category
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Healthy Categories with their Subcategories
const getHealthyCategories = async (req, res) => {
    try {
        const categories = await FoodHealthyCategory.find({ isActive: true }).sort({ createdAt: 1 });
        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Remove a specific Subcategory from a Main Category
const removeHealthySubCategory = async (req, res) => {
    try {
        const { mainCategoryId, subCategoryName } = req.params;

        const category = await FoodHealthyCategory.findById(mainCategoryId);
        if (!category) {
            return res.status(404).json({ success: false, message: "Main category not found." });
        }

        category.subCategories = category.subCategories.filter(
            s => s.name.toLowerCase() !== decodeURIComponent(subCategoryName).toLowerCase()
        );
        await category.save();

        res.json({
            success: true,
            message: `Subcategory '${subCategoryName}' removed successfully.`,
            data: category
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Entire Main Category
const deleteHealthyMainCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await FoodHealthyCategory.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Category not found." });
        }
        res.json({ success: true, message: `Category '${deleted.mainCategory}' deleted successfully.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.1 CREATE NEW HEALTHY PLAN (WITH DAY-WISE SCHEDULE & 7-DAY REPEAT) ---
const createHealthyPlan = async (req, res) => {
    try {
        const {
            title,
            description,
            tagline,
            mainCategory,
            subCategory,
            programType = 'Full Program',
            daysCount,
            dayWiseSchedule,      // 👈 JSON Array string containing Day 1, Day 2, Day 3... meals
            isRepeatAfter7Days,   // 👈 'true' | 'false'
            pricePerMeal,
            discountPricePerMeal,
            totalPrice,
            discountTotalPrice,
            maxSodium,
            maxSaturatedFat,
            caloriesAvgPerDay,
            isPopular,
            isRecommended
        } = req.body;

        if (!title || !description || !mainCategory || !subCategory || !daysCount || !pricePerMeal || !totalPrice) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required fields: title, description, mainCategory, subCategory, daysCount, pricePerMeal, totalPrice."
            });
        }

        // 1. Parse Day-Wise Meals Schedule
        let parsedSchedule = [];
        if (dayWiseSchedule) {
            if (typeof dayWiseSchedule === 'string') {
                try {
                    parsedSchedule = JSON.parse(dayWiseSchedule);
                } catch (e) {
                    parsedSchedule = [];
                }
            } else if (Array.isArray(dayWiseSchedule)) {
                parsedSchedule = dayWiseSchedule;
            }
        }

        // Format each day's meals
        parsedSchedule = parsedSchedule.map((day, idx) => ({
            dayNumber: Number(day.dayNumber) || (idx + 1),
            dayName: day.dayName || `Day ${idx + 1}`,
            breakfast: parseArray(day.breakfast),
            lunch: parseArray(day.lunch),
            dinner: parseArray(day.dinner)
        }));

        const shouldRepeat = isRepeatAfter7Days === 'true' || isRepeatAfter7Days === true;
        const totalDays = Number(daysCount);

        // 2. 🔁 7-Day Auto Repeat Logic (Agar enabled ho aur plan 7 se zyada dino ka ho)
        if (shouldRepeat && parsedSchedule.length >= 7 && totalDays > parsedSchedule.length) {
            const base7Days = [...parsedSchedule.slice(0, 7)];
            const fullSchedule = [];

            for (let i = 0; i < totalDays; i++) {
                const baseDay = base7Days[i % 7];
                fullSchedule.push({
                    dayNumber: i + 1,
                    dayName: `Day ${i + 1}`,
                    breakfast: baseDay.breakfast,
                    lunch: baseDay.lunch,
                    dinner: baseDay.dinner
                });
            }
            parsedSchedule = fullSchedule;
        }

        // 3. Media Uploads
        let bannerImagePath = null;
        let imagesArray = [];

        if (req.files) {
            if (req.files.bannerImage && req.files.bannerImage[0]) {
                bannerImagePath = `/uploads/foods/healthy_plans/${req.files.bannerImage[0].filename}`;
            }
            if (req.files.images && req.files.images.length > 0) {
                imagesArray = req.files.images.map(file => `/uploads/foods/healthy_plans/${file.filename}`);
            }
        }

        // 4. Unique ID & Pricing
        const totalCount = await FoodHealthyPlans.countDocuments();
        const planId = `HLP-${101 + totalCount}`;

        const originalTotal = Number(totalPrice);
        const discountedTotal = discountTotalPrice ? Number(discountTotalPrice) : originalTotal;
        const savingsAmount = Math.max(0, originalTotal - discountedTotal);

        const newPlan = await FoodHealthyPlans.create({
            planId,
            title,
            description,
            tagline: tagline || "",
            mainCategory: mainCategory.trim(),
            subCategory: subCategory.trim(),
            programType,
            daysCount: totalDays,
            dayWiseSchedule: parsedSchedule, // 👈 Saved Day 1, Day 2, Day 3...
            isRepeatAfter7Days: shouldRepeat,
            bannerImage: bannerImagePath,
            images: imagesArray,
            pricing: {
                pricePerMeal: Number(pricePerMeal),
                discountPricePerMeal: discountPricePerMeal ? Number(discountPricePerMeal) : 0,
                totalPrice: originalTotal,
                discountTotalPrice: discountedTotal,
                savingsAmount
            },
            nutritionalHighlights: {
                maxSodium: maxSodium || "",
                maxSaturatedFat: maxSaturatedFat || "",
                caloriesAvgPerDay: Number(caloriesAvgPerDay) || 0
            },
            isPopular: isPopular === 'true' || isPopular === true,
            isRecommended: isRecommended === 'true' || isRecommended === true
        });

        res.status(201).json({
            success: true,
            message: `Healthy Diet Plan '${title}' published successfully with ${parsedSchedule.length}-Day schedule!`,
            data: newPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.2 GET ALL HEALTHY PLANS (FIXED POPULATE ERROR) ---
// Full Path: GET /admin/food/healthy-plans/get
const getAllHealthyPlans = async (req, res) => {
    try {
        const { mainCategory, subCategory, programType, daysCount, search, page = 1, limit = 20 } = req.query;
        const query = { isActive: true };

        if (mainCategory) query.mainCategory = new RegExp(`^${mainCategory.trim()}$`, 'i');
        if (subCategory) query.subCategory = new RegExp(`^${subCategory.trim()}$`, 'i');
        if (programType) query.programType = programType;
        if (daysCount) query.daysCount = Number(daysCount);

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { title: regex },
                { description: regex },
                { mainCategory: regex },
                { subCategory: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await FoodHealthyPlans.countDocuments(query);

        // 👈 Updated path to dayWiseSchedule with strictPopulate: false
        const plans = await FoodHealthyPlans.find(query)
            .populate({
                path: 'dayWiseSchedule.breakfast',
                select: 'name imageUrl price discountPrice calories dietType foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'dayWiseSchedule.lunch',
                select: 'name imageUrl price discountPrice calories dietType foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'dayWiseSchedule.dinner',
                select: 'name imageUrl price discountPrice calories dietType foodEffectCategory',
                strictPopulate: false
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)),
            currentPage: parseInt(page, 10),
            count: plans.length,
            data: plans
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.3 GET SINGLE HEALTHY PLAN FULL DETAILS BY ID ---
// Full Path: GET /admin/food/healthy-plans/get/:id
const getHealthyPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        const plan = await FoodHealthyPlans.findOne(query)
            .populate({
                path: 'dayWiseSchedule.breakfast',
                select: 'name description imageUrl price discountPrice calories dietType ingredients tags glycemicIndex netCarbs sodium foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'dayWiseSchedule.lunch',
                select: 'name description imageUrl price discountPrice calories dietType ingredients tags glycemicIndex netCarbs sodium foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'dayWiseSchedule.dinner',
                select: 'name description imageUrl price discountPrice calories dietType ingredients tags glycemicIndex netCarbs sodium foodEffectCategory',
                strictPopulate: false
            })
            .lean();

        if (!plan) {
            return res.status(404).json({ 
                success: false, 
                message: `Healthy diet plan not found with ID/Code: '${id}'.` 
            });
        }

        res.json({ success: true, data: plan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.4 UPDATE HEALTHY PLAN (WITH GUARANTEED IMAGES ARRAY) ---
const updateHealthyPlan = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        const plan = await FoodHealthyPlans.findOne(query);

        if (!plan) {
            return res.status(404).json({ 
                success: false, 
                message: `Healthy diet plan not found with ID/Code: '${id}'.` 
            });
        }

        const updateData = {};

        // 1. Text Fields Update
        if (req.body.title) updateData.title = req.body.title.trim();
        if (req.body.description) updateData.description = req.body.description;
        if (req.body.tagline !== undefined) updateData.tagline = req.body.tagline;
        if (req.body.mainCategory) updateData.mainCategory = req.body.mainCategory.trim();
        if (req.body.subCategory) updateData.subCategory = req.body.subCategory.trim();
        if (req.body.programType) updateData.programType = req.body.programType;
        if (req.body.maxSodium !== undefined) updateData['nutritionalHighlights.maxSodium'] = req.body.maxSodium;
        if (req.body.maxSaturatedFat !== undefined) updateData['nutritionalHighlights.maxSaturatedFat'] = req.body.maxSaturatedFat;
        if (req.body.caloriesAvgPerDay !== undefined) updateData['nutritionalHighlights.caloriesAvgPerDay'] = Number(req.body.caloriesAvgPerDay);
        if (req.body.isPopular !== undefined) updateData.isPopular = req.body.isPopular === 'true' || req.body.isPopular === true;
        if (req.body.isRecommended !== undefined) updateData.isRecommended = req.body.isRecommended === 'true' || req.body.isRecommended === true;

        const totalDays = req.body.daysCount !== undefined ? Number(req.body.daysCount) : (plan.daysCount || 1);
        if (req.body.daysCount !== undefined) updateData.daysCount = totalDays;

        // 2. Day-Wise Meals Schedule Update
        if (req.body.dayWiseSchedule !== undefined) {
            let parsedSchedule = [];
            if (typeof req.body.dayWiseSchedule === 'string') {
                try {
                    parsedSchedule = JSON.parse(req.body.dayWiseSchedule);
                } catch (e) {
                    parsedSchedule = [];
                }
            } else if (Array.isArray(req.body.dayWiseSchedule)) {
                parsedSchedule = req.body.dayWiseSchedule;
            }

            parsedSchedule = parsedSchedule.map((day, idx) => ({
                dayNumber: Number(day.dayNumber) || (idx + 1),
                dayName: day.dayName || `Day ${idx + 1}`,
                breakfast: parseArray(day.breakfast),
                lunch: parseArray(day.lunch),
                dinner: parseArray(day.dinner)
            }));

            const shouldRepeat = req.body.isRepeatAfter7Days !== undefined 
                ? (req.body.isRepeatAfter7Days === 'true' || req.body.isRepeatAfter7Days === true)
                : Boolean(plan.isRepeatAfter7Days);

            if (shouldRepeat && parsedSchedule.length >= 7 && totalDays > parsedSchedule.length) {
                const base7Days = [...parsedSchedule.slice(0, 7)];
                const fullSchedule = [];
                for (let i = 0; i < totalDays; i++) {
                    const baseDay = base7Days[i % 7];
                    fullSchedule.push({
                        dayNumber: i + 1,
                        dayName: `Day ${i + 1}`,
                        breakfast: baseDay.breakfast,
                        lunch: baseDay.lunch,
                        dinner: baseDay.dinner
                    });
                }
                parsedSchedule = fullSchedule;
            }

            updateData.dayWiseSchedule = parsedSchedule;
            updateData.isRepeatAfter7Days = shouldRepeat;
        }

        // 3. 🖼️ Guaranteed Multiple Images Array & Banner
        if (req.files) {
            if (req.files.bannerImage && req.files.bannerImage.length > 0) {
                if (plan.bannerImage) deleteFile(plan.bannerImage);
                updateData.bannerImage = `/uploads/foods/healthy_plans/${req.files.bannerImage[0].filename}`;
            }

            if (req.files.images) {
                if (Array.isArray(plan.images) && plan.images.length > 0) {
                    plan.images.forEach(img => deleteFile(img));
                }

                const filesList = Array.isArray(req.files.images) 
                    ? req.files.images 
                    : [req.files.images];

                const imagesArray = [];
                for (let i = 0; i < filesList.length; i++) {
                    imagesArray.push(`/uploads/foods/healthy_plans/${filesList[i].filename}`);
                }

                updateData.images = imagesArray; // 👈 Pure Array
            }
        }

        // 4. Pricing Update
        if (req.body.pricePerMeal !== undefined) updateData['pricing.pricePerMeal'] = Number(req.body.pricePerMeal);
        if (req.body.discountPricePerMeal !== undefined) updateData['pricing.discountPricePerMeal'] = Number(req.body.discountPricePerMeal);

        if (req.body.totalPrice !== undefined || req.body.discountTotalPrice !== undefined) {
            const originalTotal = req.body.totalPrice !== undefined ? Number(req.body.totalPrice) : plan.pricing?.totalPrice || 0;
            const discountedTotal = req.body.discountTotalPrice !== undefined ? Number(req.body.discountTotalPrice) : plan.pricing?.discountTotalPrice || 0;
            updateData['pricing.totalPrice'] = originalTotal;
            updateData['pricing.discountTotalPrice'] = discountedTotal;
            updateData['pricing.savingsAmount'] = Math.max(0, originalTotal - discountedTotal);
        }

        const updated = await FoodHealthyPlans.findByIdAndUpdate(
            plan._id, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        )
        .populate('dayWiseSchedule.breakfast', 'name imageUrl price discountPrice calories dietType foodEffectCategory')
        .populate('dayWiseSchedule.lunch', 'name imageUrl price discountPrice calories dietType foodEffectCategory')
        .populate('dayWiseSchedule.dinner', 'name imageUrl price discountPrice calories dietType foodEffectCategory');

        res.json({
            success: true,
            message: `Healthy diet plan (${plan.planId}) updated successfully!`,
            data: updated
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// --- 2.5 DELETE HEALTHY PLAN ---
const deleteHealthyPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await FoodHealthyPlans.findOneAndDelete({ $or: [{ _id: id }, { planId: id }] });

        if (!plan) {
            return res.status(404).json({ success: false, message: "Healthy diet plan not found." });
        }

        // File Cleanups
        if (plan.bannerImage) deleteFile(plan.bannerImage);
        if (plan.images && plan.images.length > 0) {
            plan.images.forEach(img => deleteFile(img));
        }

        res.json({ success: true, message: "Healthy diet plan removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.6 TOGGLE ACTIVE STATUS SWITCH ---
const toggleHealthyPlanStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await FoodHealthyPlans.findOne({ $or: [{ _id: id }, { planId: id }] });

        if (!plan) {
            return res.status(404).json({ success: false, message: "Healthy diet plan not found." });
        }

        plan.isActive = !plan.isActive;
        await plan.save();

        res.json({
            success: true,
            message: `Plan is now ${plan.isActive ? 'Active' : 'Inactive'}`,
            isActive: plan.isActive,
            data: plan
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// ✏️ UPDATE HEALTHY CATEGORY & SUBCATEGORIES
// Full Path: PUT /admin/food/healthy-plans/categories/update/:id
// ==========================================
const updateHealthyCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { mainCategory, subCategories, isActive } = req.body;

        const category = await FoodHealthyCategory.findById(id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Healthy category not found." });
        }

        // Check name uniqueness if mainCategory is modified
        if (mainCategory && mainCategory.trim().toLowerCase() !== category.mainCategory.toLowerCase()) {
            const existing = await FoodHealthyCategory.findOne({
                _id: { $ne: id },
                mainCategory: new RegExp(`^${mainCategory.trim()}$`, 'i')
            });
            if (existing) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Category '${mainCategory.trim()}' already exists. Please choose a unique name.` 
                });
            }
            category.mainCategory = mainCategory.trim();
        }

        // Update Subcategories list if provided
        if (subCategories !== undefined) {
            const parsedSubCategories = Array.isArray(subCategories) ? subCategories : parseArray(subCategories);
            category.subCategories = parsedSubCategories.map(s => typeof s === 'string' ? { name: s.trim() } : s);
        }

        if (isActive !== undefined) {
            category.isActive = Boolean(isActive);
        }

        await category.save();

        res.json({
            success: true,
            message: "Healthy program category and subcategories updated successfully!",
            data: category
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    createOrUpdateHealthyCategory,
    getHealthyCategories,
    removeHealthySubCategory,
    deleteHealthyMainCategory,
    createHealthyPlan,
    getAllHealthyPlans,
    getHealthyPlanById,
    updateHealthyPlan,
    deleteHealthyPlan,
    toggleHealthyPlanStatus,
    updateHealthyCategory
};