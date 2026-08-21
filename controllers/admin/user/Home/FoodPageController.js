// controllers/admin/user/Home/FoodPageController.js

const FoodCategory = require('../../../../models/FoodCategory');
const FoodService = require('../../../../models/FoodService');
const TodaySpecial = require('../../../../models/TodaySpecialFood');
const WeeklySpecial = require('../../../../models/WeeklySpecialFood');
const VendorFoodItem = require('../../../../models/VendorFoodItem');
const VendorFoodCombo = require('../../../../models/VendorFoodCombo');
const FoodComboOffer = require('../../../../models/FoodComboOffer');

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

// ==========================================
// 🟢 2. USER-END VENDOR MENU & COMBOS DYNAMIC FETCH
// ==========================================

// --- 2.1 GET VENDOR MENU CARD WITH UNAVAILABLE FLAGS INJECTED ---
const getVendorMenuForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        const masterMeals = await FoodService.find({ isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        const vendorMappings = await VendorFoodItem.find({ vendorId }).lean();

        const finalMappedMenu = masterMeals.map(meal => {
            const mapping = vendorMappings.find(
                map => map.foodServiceId.toString() === meal._id.toString()
            );

            let UnavailableFoodItem = true;
            let finalPrice = meal.price;
            let finalDiscountPrice = meal.discountPrice;

            if (mapping && mapping.isAvailable === true) {
                UnavailableFoodItem = false;
                if (mapping.price !== null) finalPrice = mapping.price;
                if (mapping.discountPrice !== null) finalDiscountPrice = mapping.discountPrice;
            }

            return {
                ...meal,
                price: finalPrice,
                discountPrice: finalDiscountPrice,
                UnavailableFoodItem
            };
        });

        res.json({ success: true, vendorId, count: finalMappedMenu.length, data: finalMappedMenu });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.2 GET SINGLE VENDOR MENU MEAL DETAILS BY ID ---
const getVendorMenuItemById = async (req, res) => {
    try {
        const { vendorId, id } = req.params;

        const meal = await FoodService.findOne({ _id: id, isActive: true })
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .lean();

        if (!meal) {
            return res.status(404).json({ success: false, message: "Master food item not found." });
        }

        const mapping = await VendorFoodItem.findOne({ vendorId, foodServiceId: id }).lean();

        res.json({
            success: true,
            data: {
                ...meal,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.price : null,
                customDiscountPrice: mapping ? mapping.discountPrice : null,
                UnavailableFoodItem: mapping ? !mapping.isAvailable : true
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.3 GET VENDOR COMBOS LIST WITH UNAVAILABLE FLAGS INJECTED ---
const getVendorCombosForUser = async (req, res) => {
    try {
        const { vendorId } = req.params;

        const masterCombos = await FoodComboOffer.find({ isActive: true })
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        const vendorComboMappings = await VendorFoodCombo.find({ vendorId }).lean();

        const finalMappedCombos = masterCombos.map(combo => {
            const mapping = vendorComboMappings.find(
                map => map.foodComboId.toString() === combo._id.toString()
            );

            let UnavailableCombo = true;
            let finalPrice = combo.comboPrice;

            if (mapping && mapping.isAvailable === true) {
                UnavailableCombo = false;
                if (mapping.price !== null) finalPrice = mapping.price;
            }

            return {
                ...combo,
                comboPrice: finalPrice,
                UnavailableCombo
            };
        });

        res.json({ success: true, vendorId, count: finalMappedCombos.length, data: finalMappedCombos });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2.4 GET SINGLE VENDOR COMBO DETAILS BY ID ---
const getVendorComboById = async (req, res) => {
    try {
        const { vendorId, id } = req.params;

        const combo = await FoodComboOffer.findById(id)
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .lean();

        if (!combo) {
            return res.status(404).json({ success: false, message: "Combo bundle not found." });
        }

        const mapping = await VendorFoodCombo.findOne({ vendorId, foodComboId: id }).lean();

        res.json({
            success: true,
            data: {
                ...combo,
                isAvailable: mapping ? mapping.isAvailable : false,
                customPrice: mapping ? mapping.price : null,
                UnavailableCombo: mapping ? !mapping.isAvailable : true
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getFoodPageLayout,
    getTodaySpecialById,
    getUserWeeklyMenu,
    getWeeklySpecialById,

    getVendorMenuForUser,
    getVendorMenuItemById,
    getVendorCombosForUser,
    getVendorComboById
};