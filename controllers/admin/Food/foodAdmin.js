// controllers/admin/Food/foodAdmin.js

const Food = require('../../../models/Food');
const FoodService = require('../../../models/FoodService'); // 👈 Imported newly created FoodService model
const { getLocationFilter } = require('../../../middleware/authMiddleware'); // Ensure helper import

// ==========================================
// 💡 CLINICAL & PRICE CHECKS VALIDATION
// ==========================================
const validateFoodServiceRequirements = (body) => {
    const { price, discountPrice, glycemicIndex, netCarbs, sodium, potassium, phosphorus, tags } = body;

    // A. Price Validation (discountPrice must be <= original price)
    if (discountPrice !== undefined && price !== undefined && Number(discountPrice) > Number(price)) {
        throw new Error("Validation Error: Discount price cannot be greater than the original price.");
    }

    // B. Clinical Safety Guards (Figma & Specs limits)
    if (tags && Array.isArray(tags)) {
        const isDiabeticTag = tags.some(tag => tag.toLowerCase() === 'diabetic-friendly' || tag.toLowerCase() === 'low gi');
        const isHypertensionTag = tags.some(tag => tag.toLowerCase() === 'hypertension' || tag.toLowerCase() === 'low sodium');
        const isRenalTag = tags.some(tag => tag.toLowerCase() === 'renal-safe' || tag.toLowerCase() === 'kidney friendly');

        // Diabetic Guard: GI < 53 & netCarbs < 25g
        if (isDiabeticTag) {
            if (glycemicIndex !== undefined && Number(glycemicIndex) >= 53) {
                throw new Error("Clinical Violation: Glycemic index is too high for diabetic classification (Must be < 53).");
            }
            if (netCarbs !== undefined && Number(netCarbs) > 25) {
                throw new Error("Clinical Violation: Net carbohydrates are too high for diabetic classification (Must be <= 25g).");
            }
        }

        // Hypertension Guard: Sodium < 140mg
        if (isHypertensionTag) {
            if (sodium !== undefined && Number(sodium) >= 140) {
                throw new Error("Clinical Violation: Sodium content violates high blood pressure limits (Must be < 140mg).");
            }
        }

        // Kidney Guard: Potassium < 200mg & Phosphorus < 150mg
        if (isRenalTag) {
            if (potassium !== undefined && Number(potassium) >= 200) {
                throw new Error("Clinical Violation: Potassium levels exceed renal clearance thresholds (Must be < 200mg).");
            }
            if (phosphorus !== undefined && Number(phosphorus) >= 150) {
                throw new Error("Clinical Violation: Phosphorus levels exceed renal clearance thresholds (Must be < 150mg).");
            }
        }
    }
};

// ==========================================
// 1. VENDOR PROFILE OPERATIONS (Tab ID: 35)
// ==========================================

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

// ==========================================
// 2. FOOD SERVICES/MEALS OPERATIONS (Tab ID: 36)
// ==========================================

// --- 3. CREATE FOOD SERVICE ---
const createFoodService = async (req, res) => {
    try {
        const serviceData = req.body;

        // Perform dynamic checks & safety guidelines
        validateFoodServiceRequirements(serviceData);

        const newService = await FoodService.create(serviceData);

        res.status(201).json({
            success: true,
            message: "Food item added to master catalog successfully!",
            data: newService
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// --- 4. UPDATE FOOD SERVICE ---
const updateFoodService = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Pre-update checks
        validateFoodServiceRequirements(updateData);

        const service = await FoodService.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });
        
        if (!service) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        res.json({
            success: true,
            message: "Food service details updated successfully.",
            data: service
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// --- 5. DELETE FOOD SERVICE (Soft delete for dependency protection) ---
const deleteFoodService = async (req, res) => {
    try {
        const { id } = req.params;

        // Deactivating instead of cascade deleting to protect active user carts and historical subscription details
        const service = await FoodService.findByIdAndUpdate(id, { $set: { isAvailable: false, isActive: false } }, { new: true });
        
        if (!service) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        res.json({
            success: true,
            message: "Food item removed from active public catalogs successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. LIST ALL FOOD SERVICES (Publicly accessible / Optional Filter) ---
const getFoodServicesList = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", categoryId, foodId } = req.query;
        const query = { isActive: true };

        if (categoryId) query.categoryId = categoryId;
        if (foodId) query.vendorId = foodId;

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (page - 1) * limit;
        const totalDocs = await FoodService.countDocuments(query);
        const data = await FoodService.find(query)
            .populate('vendorId', 'name email address')
            .populate('categoryId', 'name')
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

// --- 7. GET SINGLE FOOD SERVICE DETAIL (Public) ---
const getFoodServiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await FoodService.findById(id)
            .populate('vendorId', 'name email address profileImage')
            .populate('categoryId', 'name');

        if (!service || !service.isActive) {
            return res.status(404).json({ success: false, message: "Food service is unavailable or suspended." });
        }

        res.json({ success: true, data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getApprovedFoodsList,
    toggleFoodActiveStatus,
    createFoodService,
    updateFoodService,
    deleteFoodService,
    getFoodServicesList,
    getFoodServiceById
};