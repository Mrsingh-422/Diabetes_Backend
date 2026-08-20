// controllers/admin/Food/FoodManage.js

const FoodService = require('../../../models/FoodService');
const Banner = require('../../../models/Banner');
const { deleteFile } = require('../../../utils/fileHandler');

// Helper to safely parse strings into arrays of strings [cite: custom_context]
const parseStringToArray = (field) => {
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
        return field.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
};

// --- 1. CREATE FOOD ITEM ---
const createFoodItem = async (req, res) => {
    try {
        const { price, discountPrice, ingredients, tags, dietType } = req.body;

        // Validation Rule: discountPrice <= price
        if (Number(discountPrice) > Number(price)) {
            return res.status(400).json({ success: false, message: "Discount price cannot be greater than the original price." });
        }

        const imagePath = req.file ? `/uploads/foods/services/${req.file.filename}` : null;

        const parsedIngredients = parseStringToArray(ingredients);
        const parsedTags = parseStringToArray(tags);

        // Normalize dietType (E.g. if 'Non-Veg' comes, map it to 'Non Veg' with space)
        let normalizedDietType = dietType;
        if (dietType === 'Non-Veg') normalizedDietType = 'Non Veg';

        const newFood = await FoodService.create({
            ...req.body,
            dietType: normalizedDietType,
            ingredients: parsedIngredients,
            tags: parsedTags,
            imageUrl: imagePath 
        });

        res.status(201).json({
            success: true,
            message: "Food item added successfully!",
            data: newFood
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET ALL FOOD ITEMS (Filtered) ---
const getFoodItems = async (req, res) => {
    try {
        const { search, foodType, foodEffectCategory, categoryId } = req.query;
        const query = {};

        if (categoryId) query.categoryId = categoryId;
        if (foodType) query.dietType = foodType; 
        if (foodEffectCategory) query.foodEffectCategory = foodEffectCategory; // 👈 Updated filter key

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { ingredients: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        const items = await FoodService.find(query)
            .populate('categoryId', 'foodCategory foodEffectCategory')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: items.length,
            data: items
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. GET SINGLE FOOD ITEM ---
const getFoodItemById = async (req, res) => {
    try {
        const { id } = req.params;
        const item = await FoodService.findById(id).populate('categoryId', 'foodCategory');

        if (!item) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        res.json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. UPDATE FOOD ITEM ---
const updateFoodItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { price, discountPrice, ingredients, tags, dietType } = req.body;

        const item = await FoodService.findById(id);
        if (!item) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        if (price !== undefined && discountPrice !== undefined) {
            if (Number(discountPrice) > Number(price)) {
                return res.status(400).json({ success: false, message: "Discount price cannot exceed the original price." });
            }
        }

        const updateData = { ...req.body };

        if (ingredients !== undefined) updateData.ingredients = parseStringToArray(ingredients);
        if (tags !== undefined) updateData.tags = parseStringToArray(tags);
        
        if (dietType !== undefined) {
            updateData.dietType = dietType === 'Non-Veg' ? 'Non Veg' : dietType;
        }

        if (req.file) {
            if (item.imageUrl) {
                deleteFile(item.imageUrl);
            }
            updateData.imageUrl = `/uploads/foods/services/${req.file.filename}`;
        }

        const updatedItem = await FoodService.findByIdAndUpdate(id, { $set: updateData }, { new: true });

        res.json({
            success: true,
            message: "Food item updated successfully!",
            data: updatedItem
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. DELETE FOOD ITEM ---
const deleteFoodItem = async (req, res) => {
    try {
        const { id } = req.params;
        const item = await FoodService.findById(id);
        
        if (!item) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        if (item.imageUrl) {
            deleteFile(item.imageUrl);
        }

        await FoodService.findByIdAndDelete(id);

        res.json({ success: true, message: "Food item deleted successfully!" });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. TOGGLE AVAILABILITY STATUS ---
const toggleFoodAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const item = await FoodService.findById(id);

        if (!item) {
            return res.status(404).json({ success: false, message: "Food item not found." });
        }

        item.isActive = !item.isActive;
        await item.save();

        res.json({
            success: true,
            message: `Food status updated successfully. Currently ${item.isActive ? 'Active' : 'Inactive'}`,
            isActive: item.isActive,
            data: item
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔴 HERO BANNER OPERATIONS (Category: 'Food' / Rich Media Support)
// ==========================================

// --- 7. CREATE NEW HERO BANNER (Handles both Image & Video uploads) ---
const createHeroBanner = async (req, res) => {
    try {
        const { title, link, priority, badgeText, taglineColor, description, overlayOpacity, isActive } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload a media file (Image or Video)." });
        }

        const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        const fileDestinationPath = `/uploads/banners/${req.file.filename}`;

        const newBanner = await Banner.create({
            title,
            image: [fileDestinationPath], // 👈 Saved as array path matching your schema
            link: link || "/food/menu",
            category: 'Food', // Strictly mapped for Food landing page
            status: (isActive === 'true' || isActive === true) ? 'Active' : 'Inactive', // Syncs status enum
            priority: Number(priority) || 0,
            
            // Advanced clinical landing properties
            type: mediaType,
            badgeText: badgeText || "",
            taglineColor: taglineColor || '#00B574',
            description: description || "",
            overlayOpacity: Number(overlayOpacity) || 60
        });

        res.status(201).json({
            success: true,
            message: "Front page hero banner published successfully!",
            data: newBanner
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 8. GET ALL BANNERS (List & Priority sorting) ---
const getHeroBanners = async (req, res) => {
    try {
        const { activeOnly } = req.query;
        const filter = { category: 'Food' }; // Filter specifically for Food Page banners
        
        if (activeOnly === 'true') {
            filter.status = 'Active';
        }

        const banners = await Banner.find(filter).sort({ priority: 1, createdAt: -1 });

        res.json({
            success: true,
            count: banners.length,
            data: banners
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 9. GET SINGLE BANNER DETAILS ---
const getHeroBannerById = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await Banner.findOne({ _id: id, category: 'Food' });

        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner configuration not found." });
        }

        res.json({ success: true, data: banner });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 10. UPDATE HERO BANNER (With local files unlinking) ---
const updateHeroBanner = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await Banner.findOne({ _id: id, category: 'Food' });

        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner configuration not found." });
        }

        const updateData = { ...req.body };

        // Handle Active/Inactive status mapping
        if (req.body.isActive !== undefined) {
            updateData.status = (req.body.isActive === 'true' || req.body.isActive === true) ? 'Active' : 'Inactive';
        }

        if (req.file) {
            // Delete old media source to avoid physical server storage bloat
            if (banner.image && banner.image.length > 0 && banner.image[0]) {
                deleteFile(banner.image[0]);
            }
            updateData.image = [`/uploads/banners/${req.file.filename}`];
            updateData.type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        }

        const updatedBanner = await Banner.findByIdAndUpdate(id, { $set: updateData }, { new: true });

        res.json({
            success: true,
            message: "Hero banner updated successfully!",
            data: updatedBanner
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 11. DELETE HERO BANNER ---
const deleteHeroBanner = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await Banner.findOne({ _id: id, category: 'Food' });

        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner configuration not found." });
        }

        if (banner.image && banner.image.length > 0 && banner.image[0]) {
            deleteFile(banner.image[0]);
        }

        await Banner.findByIdAndDelete(id);

        res.json({ success: true, message: "Hero banner configuration removed successfully." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 12. TOGGLE BANNER ACTIVE STATUS SWITCH ---
const toggleBannerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await Banner.findOne({ _id: id, category: 'Food' });

        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner configuration not found." });
        }

        const newStatus = banner.status === 'Active' ? 'Inactive' : 'Active';

        const updatedBanner = await Banner.findByIdAndUpdate(
            id,
            { $set: { status: newStatus } },
            { new: true }
        );

        res.json({
            success: true,
            message: `Banner visibility is now ${updatedBanner.status}`,
            isActive: updatedBanner.status === 'Active',
            data: updatedBanner
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    createFoodItem,
    getFoodItems,
    getFoodItemById,
    updateFoodItem,
    deleteFoodItem,
    toggleFoodAvailability,
     // Banner Exports
     createHeroBanner,
     getHeroBanners,
     getHeroBannerById,
     updateHeroBanner,
     deleteHeroBanner,
     toggleBannerStatus
};