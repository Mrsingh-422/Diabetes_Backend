// controllers/admin/Food/TiffinPlanAdminController.js

const TiffinPlan = require('../../../models/TiffinPlan');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');

// ==========================================
// 💡 0. GET CATALOG POOL FOR MODAL (DISHES + COMBOS)
// ==========================================
const getCatalogPoolForModal = async (req, res) => {
    try {
        const { search } = req.query;
        let foodFilter = { isActive: true };
        let comboFilter = { isActive: true };

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            foodFilter.name = regex;
            comboFilter.name = regex;
        }

        // 1. Fetch Single Meals
        const dishes = await FoodService.find(foodFilter)
            .select('name description imageUrl price discountPrice calories dietType foodEffectCategory')
            .lean();

        const formattedDishes = dishes.map(dish => ({
            _id: dish._id,
            name: dish.name,
            description: dish.description,
            imageUrl: dish.imageUrl,
            price: dish.discountPrice > 0 ? dish.discountPrice : dish.price,
            originalPrice: dish.price,
            calories: dish.calories,
            dietType: dish.dietType,
            foodEffectCategory: dish.foodEffectCategory,
            productType: 'FoodService'
        }));

        // 2. Fetch Combo Bundles
        const combos = await FoodComboOffer.find(comboFilter)
            .populate('dishes.foodServiceId', 'name calories dietType')
            .select('comboId name description basePrice comboPrice spicyLevel isPopular isRecommended dishes')
            .lean();

        const formattedCombos = combos.map(combo => {
            const totalCalories = combo.dishes?.reduce((sum, d) => sum + (d.foodServiceId?.calories || 0) * (d.quantity || 1), 0) || 0;
            return {
                _id: combo._id,
                comboId: combo.comboId,
                name: combo.name,
                description: combo.description,
                imageUrl: null,
                price: combo.comboPrice,
                originalPrice: combo.basePrice,
                calories: totalCalories,
                dietType: 'Combo Pack',
                foodEffectCategory: 'Combo Bundle',
                productType: 'FoodComboOffer'
            };
        });

        // Combined pool list for easy rendering inside tabs
        const allItems = [...formattedDishes, ...formattedCombos];

        res.json({
            success: true,
            totalItems: allItems.length,
            dishesCount: formattedDishes.length,
            combosCount: formattedCombos.length,
            data: {
                all: allItems,
                dishes: formattedDishes,
                combos: formattedCombos
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 1. CREATE SUBSCRIPTION PLAN (SLOT-WISE SUPPORT)
// ==========================================
const createTiffinPlan = async (req, res) => {
    try {
        const { 
            name, 
            planCycle, 
            mealsPerDay, 
            price, 
            permittedSlots, 
            slotDishes,
            dishPool,
            description 
        } = req.body;

        if (!name || !planCycle || !mealsPerDay || !price || !permittedSlots || !description) {
            return res.status(400).json({ success: false, message: "All required fields must be provided." });
        }

        if (!Array.isArray(permittedSlots) || permittedSlots.length === 0) {
            return res.status(400).json({ success: false, message: "At least one permitted meal slot must be selected." });
        }

        // Helper to format slot array
        const formatSlotArray = (items) => {
            if (!Array.isArray(items)) return [];
            return items.map(item => {
                if (typeof item === 'string') {
                    return { itemType: 'FoodService', itemId: item };
                }
                return {
                    itemType: item.itemType || 'FoodService',
                    itemId: item.itemId || item._id
                };
            });
        };

        const formattedSlotDishes = {
            breakfast: formatSlotArray(slotDishes?.breakfast),
            lunch: formatSlotArray(slotDishes?.lunch),
            dinner: formatSlotArray(slotDishes?.dinner)
        };

        // Total dish check
        const totalSelected = formattedSlotDishes.breakfast.length + formattedSlotDishes.lunch.length + formattedSlotDishes.dinner.length;
        const legacyDishPool = Array.isArray(dishPool) ? dishPool : [];

        if (totalSelected === 0 && legacyDishPool.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Please select dishes for at least one active meal slot (Breakfast, Lunch, or Dinner)." 
            });
        }

        // Auto-generate Plan ID (E.g. PLN-101, PLN-102)
        const count = await TiffinPlan.countDocuments();
        const planId = `PLN-${101 + count}`;

        const newPlan = await TiffinPlan.create({
            planId,
            name,
            planCycle,
            mealsPerDay: Number(mealsPerDay),
            price: Number(price),
            permittedSlots,
            slotDishes: formattedSlotDishes,
            dishPool: legacyDishPool.length > 0 ? legacyDishPool : formattedSlotDishes.lunch.map(d => d.itemId),
            description
        });

        res.status(201).json({
            success: true,
            message: "Subscription plan tier created successfully!",
            data: newPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 2. GET ALL SUBSCRIPTION PLANS
// ==========================================
const getAllTiffinPlans = async (req, res) => {
    try {
        const plans = await TiffinPlan.find()
            .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType')
            .populate('dishPool', 'name imageUrl price discountPrice dietType calories')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: plans.length,
            data: plans
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 3. GET SINGLE PLAN DETAILS BY ID
// ==========================================
const getTiffinPlanById = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await TiffinPlan.findOne({
            $or: [{ _id: id }, { planId: id }]
        })
        .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory')
        .populate('dishPool', 'name imageUrl price discountPrice dietType calories');

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            data: plan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 4. UPDATE SUBSCRIPTION PLAN
// ==========================================
const updateTiffinPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        // If slotDishes sent, format properly
        if (updateData.slotDishes) {
            const formatSlotArray = (items) => {
                if (!Array.isArray(items)) return [];
                return items.map(item => {
                    if (typeof item === 'string') return { itemType: 'FoodService', itemId: item };
                    return {
                        itemType: item.itemType || 'FoodService',
                        itemId: item.itemId || item._id
                    };
                });
            };

            updateData.slotDishes = {
                breakfast: formatSlotArray(updateData.slotDishes.breakfast),
                lunch: formatSlotArray(updateData.slotDishes.lunch),
                dinner: formatSlotArray(updateData.slotDishes.dinner)
            };
        }

        const plan = await TiffinPlan.findOneAndUpdate(
            { $or: [{ _id: id }, { planId: id }] },
            { $set: updateData },
            { new: true, runValidators: true }
        )
        .populate('slotDishes.breakfast.itemId', 'name imageUrl price discountPrice')
        .populate('slotDishes.lunch.itemId', 'name imageUrl price discountPrice')
        .populate('slotDishes.dinner.itemId', 'name imageUrl price discountPrice');

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            message: "Subscription plan updated successfully!",
            data: plan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 5. DELETE SUBSCRIPTION PLAN
// ==========================================
const deleteTiffinPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await TiffinPlan.findOneAndDelete({
            $or: [{ _id: id }, { planId: id }]
        });

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        res.json({
            success: true,
            message: "Subscription plan removed successfully."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 💡 6. TOGGLE ACTIVE STATUS SWITCH
// ==========================================
const toggleTiffinPlanStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await TiffinPlan.findOne({ $or: [{ _id: id }, { planId: id }] });
        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        const updatedPlan = await TiffinPlan.findByIdAndUpdate(
            plan._id,
            { $set: { isActive: !plan.isActive } },
            { new: true }
        );

        res.json({
            success: true,
            message: `Plan status updated to ${updatedPlan.isActive ? 'Active' : 'Inactive'}`,
            isActive: updatedPlan.isActive,
            data: updatedPlan
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getCatalogPoolForModal,
    createTiffinPlan,
    getAllTiffinPlans,
    getTiffinPlanById,
    updateTiffinPlan,
    deleteTiffinPlan,
    toggleTiffinPlanStatus
};