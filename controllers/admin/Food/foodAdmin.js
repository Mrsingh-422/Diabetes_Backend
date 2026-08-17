// Import the model as requested
const Food = require('../../../models/Food');
const { getLocationFilter } = require('../../../middleware/authMiddleware');// Ensure helper import

// --- 1. GET APPROVED FOOD PARTNERS LIST ---
const getApprovedFoodsList = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", country, state, city } = req.query;
        
        // Apply geographic location filters based on admin privileges
        const locFilter = getLocationFilter ? getLocationFilter(req) : {};
        
        // Constrain profileStatus to 'Approved'
        const filter = { ...locFilter, profileStatus: 'Approved' };
        
        if (country) filter.country = { $regex: country, $options: 'i' };
        if (state) filter.state = { $regex: state, $options: 'i' };
        if (city) filter.city = { $regex: city, $options: 'i' };
        
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (page - 1) * limit;
        const totalDocs = await Food.countDocuments(filter);
        const data = await Food.find(filter)
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });
            
        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: parseInt(page),
            data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. TOGGLE FOOD PARTNER ACTIVE STATUS (BLOCK/UNBLOCK) ---
const toggleFoodActiveStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const food = await Food.findById(id);
        
        if (!food) {
            return res.status(404).json({ success: false, message: 'Food partner not found' });
        }
        
        // Toggle boolean state
        food.isActive = !food.isActive;
        await food.save();
        
        res.json({
            success: true,
            message: `Food partner has been ${food.isActive ? 'activated' : 'deactivated'} successfully.`,
            isActive: food.isActive,
            data: food
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getApprovedFoodsList,
    toggleFoodActiveStatus
};