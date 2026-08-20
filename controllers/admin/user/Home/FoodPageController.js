// controllers/admin/user/Home/FoodPageController.js

const FoodCategory = require('../../../../models/FoodCategory');
const FoodService = require('../../../../models/FoodService');
const TodaySpecial = require('../../../../models/TodaySpecialFood');
const WeeklySpecial = require('../../../../models/WeeklySpecialFood');

// --- 1. GET FULL FOOD PAGE LAYOUT DATA (Unified Handshake with Paginated Today's Specials) ---
const getFoodPageLayout = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // A. Fetch Categories (Dynamic tiles)
        const categories = await FoodCategory.find()
            .sort({ createdAt: -1 });

        // B. Fetch Paginated Today's Specials (Compulsory 20 limit)
        const totalDocs = await TodaySpecial.countDocuments();
        const rawSpecials = await TodaySpecial.find()
            .populate({
                path: 'foodItemId',
                populate: { path: 'categoryId', select: 'foodCategory' }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const todaySpecials = rawSpecials
            .filter(s => s.foodItemId !== null)
            .map(s => s.foodItemId); 

        // C. Fetch Popular Meals (Standard 6 limit)
        const popularMeals = await FoodService.find({ isPopular: true, isActive: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 });

        // D. Fetch Recommended Meals (Standard 6 limit)
        const recommendedMeals = await FoodService.find({ isRecommended: true, isActive: true })
            .limit(6)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .sort({ createdAt: -1 });

        // 🚨 RESTORED: Handshake keys are completely restored to match your original successful response!
        res.json({
            success: true,
            data: {
                categories,
                todaySpecials, // Paginated array inside nested object
                popularMeals,
                recommendedMeals,
                pagination: { // Meta properties included safely
                    totalDocs,
                    totalPages: Math.ceil(totalDocs / parseInt(limit)),
                    currentPage: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET SINGLE TODAY'S SPECIAL DETAIL BY ID ---
const getTodaySpecialById = async (req, res) => {
    try {
        const { id } = req.params;
        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory');

        if (!meal) {
            return res.status(404).json({ success: false, message: "Today's special detail not found." });
        }

        res.json({ success: true, data: meal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. GET USER TIFFIN WEEKLY PLANNER CALENDAR ---
const getUserWeeklyMenu = async (req, res) => {
    try {
        const weeklyMenu = await WeeklySpecial.find()
            .populate('meals', 'name price calories imageUrl dietType');

        const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        const calendarPlan = weekdays.map(day => {
            const foundDay = weeklyMenu.find(m => m.dayOfWeek === day);
            return {
                dayOfWeek: day,
                mealsCount: foundDay ? foundDay.meals.length : 0,
                meals: foundDay ? foundDay.meals : []
            };
        });

        res.json({
            success: true,
            data: calendarPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. GET SINGLE WEEKLY PLAN MEAL DETAIL BY ID ---
const getWeeklySpecialById = async (req, res) => {
    try {
        const { id } = req.params;
        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory');

        if (!meal) {
            return res.status(404).json({ success: false, message: "Weekly plan tiffin details not found." });
        }

        res.json({ success: true, data: meal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById
};