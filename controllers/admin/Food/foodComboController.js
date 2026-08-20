// controllers/admin/Food/foodComboController.js

const FoodComboOffer = require('../../../models/FoodComboOffer');
const FoodService = require('../../../models/FoodService');

// Helper to calculate dynamic basePrice
const calculateComboBasePrice = async (dishesArray) => {
    let basePrice = 0;
    for (let item of dishesArray) {
        const dish = await FoodService.findById(item.foodServiceId);
        if (!dish) {
            throw new Error(`Dish detail with ID ${item.foodServiceId} was not found in catalog.`);
        }
        // Picks the active discount price, fallbacks to price if null
        const activePrice = dish.discountPrice || dish.price || 0;
        basePrice += (Number(activePrice) * Number(item.quantity || 1));
    }
    return basePrice;
};

// --- 1. CREATE NEW COMBO OFFER ---
const createComboOffer = async (req, res) => {
    try {
        const { name, description, comboPrice, spicyLevel, isPopular, isRecommended, dishes } = req.body;

        if (!dishes || !Array.isArray(dishes) || dishes.length < 2) {
            return res.status(400).json({ success: false, message: "A combo offer must contain at least 2 dishes." });
        }

        // Calculate dynamic basePrice using database records
        const basePrice = await calculateComboBasePrice(dishes);

        // Validation Rule: comboPrice < basePrice
        if (Number(comboPrice) >= basePrice) {
            return res.status(400).json({ 
                success: false, 
                message: `Discounted combo price (₹${comboPrice}) must be strictly less than the base price (₹${basePrice}).` 
            });
        }

        // Generate dynamic Unique ID like CMB-801
        const uniqueCount = await FoodComboOffer.countDocuments();
        const comboId = `CMB-${801 + uniqueCount}`;

        const combo = await FoodComboOffer.create({
            comboId,
            name,
            description,
            basePrice,
            comboPrice: Number(comboPrice),
            spicyLevel: spicyLevel || 'Medium (Regular)',
            isPopular: isPopular === true,
            isRecommended: isRecommended === true,
            dishes
        });

        res.status(201).json({
            success: true,
            message: "New Combo Offer assembled and published successfully!",
            data: combo
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET ALL COMBOS LIST ---
const getComboOffers = async (req, res) => {
    try {
        const { activeOnly } = req.query;
        const filter = {};
        if (activeOnly === 'true') {
            filter.isActive = true;
        }

        // Deep populate to fetch all nested dish fields for catalog cards (E.g. Calories, prices)
        const combos = await FoodComboOffer.find(filter)
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: combos.length,
            data: combos
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. GET SINGLE COMBO BY ID ---
const getComboOfferById = async (req, res) => {
    try {
        const { id } = req.params;
        const combo = await FoodComboOffer.findById(id)
            .populate({
                path: 'dishes.foodServiceId',
                select: 'name price discountPrice imageUrl dietType calories'
            });

        if (!combo) {
            return res.status(404).json({ success: false, message: "Combo offer configuration not found." });
        }

        res.json({ success: true, data: combo });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. UPDATE COMBO DETAILS ---
const updateComboOffer = async (req, res) => {
    try {
        const { id } = req.params;
        const { comboPrice, dishes } = req.body;

        const combo = await FoodComboOffer.findById(id);
        if (!combo) {
            return res.status(404).json({ success: false, message: "Combo offer not found." });
        }

        const updateData = { ...req.body };

        // Recalculate price parameters if items or combo price is changed
        if (dishes || comboPrice !== undefined) {
            const activeDishes = dishes || combo.dishes;
            const computedBasePrice = await calculateComboBasePrice(activeDishes);
            updateData.basePrice = computedBasePrice;

            const activeComboPrice = comboPrice !== undefined ? comboPrice : combo.comboPrice;

            if (Number(activeComboPrice) >= computedBasePrice) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Discounted price (₹${activeComboPrice}) must be less than base price (₹${computedBasePrice}).` 
                });
            }
        }

        const updatedCombo = await FoodComboOffer.findByIdAndUpdate(id, { $set: updateData }, { new: true })
            .populate('dishes.foodServiceId');

        res.json({
            success: true,
            message: "Combo offer updated successfully!",
            data: updatedCombo
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. DELETE COMBO OFFER ---
const deleteComboOffer = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await FoodComboOffer.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Combo offer not found." });
        }

        res.json({ success: true, message: "Combo offer configuration removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. TOGGLE COMBO AVAILABILITY STATUS SWITCH ---
const toggleComboAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const combo = await FoodComboOffer.findById(id);

        if (!combo) {
            return res.status(404).json({ success: false, message: "Combo offer not found." });
        }

        // Bypasses validation triggers to safely switch status
        const updatedCombo = await FoodComboOffer.findByIdAndUpdate(
            id,
            { $set: { isActive: !combo.isActive } },
            { new: true }
        );

        res.json({
            success: true,
            message: `Combo availability set to ${updatedCombo.isActive ? 'Available' : 'Unavailable'}`,
            isActive: updatedCombo.isActive,
            data: updatedCombo
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createComboOffer,
    getComboOffers,
    getComboOfferById,
    updateComboOffer,
    deleteComboOffer,
    toggleComboAvailability
};