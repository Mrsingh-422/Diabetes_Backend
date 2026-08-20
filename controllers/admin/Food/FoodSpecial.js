// controllers/admin/Food/FoodSpecial.js

const TodaySpecial = require('../../../models/TodaySpecialFood');
const WeeklySpecial = require('../../../models/WeeklySpecialFood');
const FoodService = require('../../../models/FoodService');

// ==========================================
// 🔴 TODAY'S SPECIALS OPERATIONS (Figma Screen 1 & 3)
// ==========================================

// --- 1. GET ALL SELECTED TODAY'S SPECIALS ---
const getTodaySpecials = async (req, res) => {
    try {
        const specials = await TodaySpecial.find()
            .populate({
                path: 'foodItemId',
                populate: { path: 'categoryId', select: 'foodCategory' }
            })
            .sort({ createdAt: -1 });

        // Filter out any potential null/broken references gracefully
        const activeSpecials = specials.filter(s => s.foodItemId !== null);

        res.json({
            success: true,
            count: activeSpecials.length,
            data: activeSpecials
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. SAVE & PUBLISH SELECTED TODAY'S SPECIALS (Figma Modal "Close & Publish" Button) ---
const publishTodaySpecials = async (req, res) => {
    try {
        const { foodItemIds } = req.body; // Array of selected food item IDs from frontend checkboxes

        if (!foodItemIds || !Array.isArray(foodItemIds)) {
            return res.status(400).json({ success: false, message: "foodItemIds array is required." });
        }

        // Within a single database operation, replace the previous selection list entirely
        await TodaySpecial.deleteMany({});

        const mappedSpecials = foodItemIds.map(id => ({ foodItemId: id }));
        const published = await TodaySpecial.insertMany(mappedSpecials);

        res.json({
            success: true,
            message: `${published.length} Today's active specials published successfully!`,
            data: published
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. REMOVE SINGLE TODAY'S SPECIAL (Figma "Remove Special" Button) ---
const removeTodaySpecial = async (req, res) => {
    try {
        const { id } = req.params; // ObjectID of the TodaySpecial entry (not the FoodService ID)

        const deleted = await TodaySpecial.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Selected special item not found." });
        }

        res.json({ success: true, message: "Item removed from today's active specials list." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🔵 WEEKLY MENU PLANNER OPERATIONS (Figma Screen 2)
// ==========================================

// --- 4. GET FULL WEEKLY TEMPLATE MENU ---
const getWeeklyTemplateMenu = async (req, res) => {
    try {
        const weeklyMenu = await WeeklySpecial.find()
            .populate('meals', 'name price calories imageUrl dietType');

        // Create standard structure fallback for days not configured yet
        const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const responseData = weekdays.map(day => {
            const foundDay = weeklyMenu.find(m => m.dayOfWeek === day);
            return {
                dayOfWeek: day,
                mealsCount: foundDay ? foundDay.meals.length : 0,
                meals: foundDay ? foundDay.meals : []
            };
        });

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. EDIT/UPDATE DAY MENU (Figma "Edit Day Menu" Save Action) ---
const updateDayMenuTemplate = async (req, res) => {
    try {
        const { day } = req.params; // Monday, Tuesday, etc.
        const { foodItemIds } = req.body; // Array of food items selected for this day

        const normalizedDay = day.toLowerCase();
        const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        if (!weekdays.includes(normalizedDay)) {
            return res.status(400).json({ success: false, message: "Invalid weekday name parameter." });
        }

        if (!foodItemIds || !Array.isArray(foodItemIds)) {
            return res.status(400).json({ success: false, message: "foodItemIds array is required." });
        }

        // Upsert operations: Update if exists, else create new day mapping
        const updatedDayMenu = await WeeklySpecial.findOneAndUpdate(
            { dayOfWeek: normalizedDay },
            { $set: { meals: foodItemIds } },
            { upsert: true, new: true }
        ).populate('meals', 'name price calories imageUrl');

        res.json({
            success: true,
            message: `${normalizedDay.toUpperCase()} menu template successfully updated!`,
            data: updatedDayMenu
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getTodaySpecials,
    publishTodaySpecials,
    removeTodaySpecial,
    getWeeklyTemplateMenu,
    updateDayMenuTemplate
};