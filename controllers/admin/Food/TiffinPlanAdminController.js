// controllers/admin/Food/TiffinPlanAdminController.js

const TiffinPlan = require('../../../models/TiffinPlan');
const FoodService = require('../../../models/FoodService');
const FoodComboOffer = require('../../../models/FoodComboOffer');
const mongoose = require('mongoose');
const FoodBooking = require('../../../models/FoodBooking');
const VendorTiffinPlan = require('../../../models/VendorTiffinPlan');

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
// 💡 2. GET ALL SUBSCRIPTION PLANS (WITH SUBSCRIBER COUNTS ADDED)
// Full Path: GET /admin/food/tiffin/plans/get
// ==========================================
const getAllTiffinPlans = async (req, res) => {
    try {
        const rawPlans = await TiffinPlan.find()
            .populate({
                path: 'slotDishes.breakfast.itemId',
                select: 'name imageUrl price discountPrice calories dietType',
                strictPopulate: false
            })
            .populate({
                path: 'slotDishes.lunch.itemId',
                select: 'name imageUrl price discountPrice calories dietType',
                strictPopulate: false
            })
            .populate({
                path: 'slotDishes.dinner.itemId',
                select: 'name imageUrl price discountPrice calories dietType',
                strictPopulate: false
            })
            .populate({
                path: 'dishPool',
                select: 'name imageUrl price discountPrice dietType calories',
                strictPopulate: false
            })
            .sort({ createdAt: -1 })
            .lean();

        // 🧮 Fast Aggregation: Plan-wise Total & Active Subscribers Count
        const subscriptionStats = await FoodBooking.aggregate([
            { $match: { bookingType: 'Subscription' } },
            {
                $group: {
                    _id: '$subscriptionDetails.planId',
                    totalSubscribersCount: { $sum: 1 },
                    activeSubscribersCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] }
                    }
                }
            }
        ]);

        const statsMap = new Map();
        subscriptionStats.forEach(s => {
            if (s._id) statsMap.set(s._id.toString(), s);
        });

        // Map plans with subscriber counts (Zero existing fields changed)
        const plans = rawPlans.map(plan => {
            const statById = statsMap.get(plan._id.toString());
            const statByCode = statsMap.get(plan.planId);
            const totalSubscribersCount = (statById?.totalSubscribersCount || 0) + (statByCode?.totalSubscribersCount || 0);
            const activeSubscribersCount = (statById?.activeSubscribersCount || 0) + (statByCode?.activeSubscribersCount || 0);

            return {
                ...plan,
                // 🌟 Added Subscriber Counts
                totalSubscribersCount,
                activeSubscribersCount
            };
        });

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
// 💡 3. GET SINGLE PLAN DETAILS BY ID (WITH SUBSCRIBER COUNTS ADDED)
// Full Path: GET /admin/food/tiffin/plans/get/:id
// ==========================================
const getTiffinPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        const plan = await TiffinPlan.findOne(query)
            .populate({
                path: 'slotDishes.breakfast.itemId',
                select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'slotDishes.lunch.itemId',
                select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'slotDishes.dinner.itemId',
                select: 'name imageUrl price discountPrice calories dietType ingredients tags foodEffectCategory',
                strictPopulate: false
            })
            .populate({
                path: 'dishPool',
                select: 'name imageUrl price discountPrice dietType calories',
                strictPopulate: false
            })
            .lean();

        if (!plan) {
            return res.status(404).json({ 
                success: false, 
                message: `Subscription plan not found with ID/Code: '${id}'.` 
            });
        }

        // 🧮 Count total and active subscribers for this specific plan
        const planIdStr = plan._id.toString();
        const planCode = plan.planId;

        const [totalSubscribersCount, activeSubscribersCount] = await Promise.all([
            FoodBooking.countDocuments({
                bookingType: 'Subscription',
                $or: [
                    { "subscriptionDetails.planId": planIdStr },
                    { "subscriptionDetails.planId": planCode }
                ]
            }),
            FoodBooking.countDocuments({
                bookingType: 'Subscription',
                status: 'Active',
                $or: [
                    { "subscriptionDetails.planId": planIdStr },
                    { "subscriptionDetails.planId": planCode }
                ]
            })
        ]);

        res.json({
            success: true,
            data: {
                ...plan,
                // 🌟 Added Subscriber Counts
                totalSubscribersCount,
                activeSubscribersCount
            }
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
// 💡 5. SMART CONDITIONAL DELETE TIFFIN PLAN (HARD VS SOFT DELETE)
// Full Path: DELETE /admin/food/tiffin/plans/delete/:id
// ==========================================
const deleteTiffinPlan = async (req, res) => {
    try {
        const { id } = req.params;

        // 🛡️ Safe Query Builder (ObjectId & PLN Code dono support karega)
        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { planId: id }] }
            : { planId: id };

        const plan = await TiffinPlan.findOne(query);

        if (!plan) {
            return res.status(404).json({ success: false, message: "Subscription plan not found." });
        }

        // 🔍 Step 1: Check if ANY user has ever purchased/subscribed to this plan
        const hasPurchases = await FoodBooking.exists({
            bookingType: 'Subscription',
            $or: [
                { "subscriptionDetails.planId": plan._id.toString() },
                { "subscriptionDetails.planId": plan.planId }
            ]
        });

        // ====================================================
        // 🟢 CASE 1: PERMANENT (HARD) DELETE — Never Subscribed
        // ====================================================
        if (!hasPurchases) {
            // 1. Remove all vendor inventory mappings completely
            await VendorTiffinPlan.deleteMany({ planId: plan._id });

            // 2. Permanently remove document from database
            await TiffinPlan.findByIdAndDelete(plan._id);

            return res.json({
                success: true,
                deletionType: "Permanent (Hard Delete)",
                message: `Subscription Plan '${plan.name}' (${plan.planId}) had no user subscriptions and has been permanently removed from database.`,
                data: {
                    planId: plan.planId,
                    isPermanentlyDeleted: true
                }
            });
        }

        // ====================================================
        // 🟡 CASE 2: ARCHIVED (SOFT) DELETE — Active/Past Subscribers Exist
        // ====================================================
        plan.isDeleted = true;
        plan.isActive = false;
        plan.deletedAt = new Date();
        await plan.save();

        // Disable availability for all kitchens
        await VendorTiffinPlan.updateMany(
            { planId: plan._id },
            { $set: { isAvailable: false } }
        );

        return res.json({
            success: true,
            deletionType: "Archived (Soft Delete)",
            message: `Subscription Plan '${plan.name}' (${plan.planId}) has historical user subscriptions. It has been archived and disabled from public view without breaking user subscription history.`,
            data: {
                planId: plan.planId,
                isDeleted: true,
                isActive: false,
                deletedAt: plan.deletedAt
            }
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