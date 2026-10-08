// controllers/admin/CGM/DiabetesCoachAdminController.js

const DiabetesCoach = require('../../../models/DiabetesCoach');
const { deleteFile } = require('../../../utils/fileHandler');
const { generateCoachSlots } = require('../../../utils/timeSlotHelper');
const bcrypt = require('bcryptjs');

// Helper to remove old file
const removeOldFile = (filePath) => {
    if (!filePath) return;
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const publicPath = cleanPath.startsWith('public') ? cleanPath : `public/${cleanPath}`;
    deleteFile(publicPath);
};

// Safe JSON parser for languages/location strings
const safeParse = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
};

// 1. Create Coach (With Password Hashing)
const createCoach = async (req, res) => {
    try {
        const body = req.body;

        if (!body.name || body.price === undefined || !body.password) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "Coach name, price, and login password are required." 
            });
        }

        // 🔐 Password Hashing
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(body.password.trim(), salt);

        const profileImage = req.file ? `/uploads/diabetes_coaches/${req.file.filename}` : null;
        const languages = safeParse(body.languages, body.languages ? [body.languages] : ["Hindi", "English"]);
        const locationData = safeParse(body.location, {
            lat: Number(body.lat) || 0,
            lng: Number(body.lng) || 0,
            address: body.address || "",
            city: body.city || "",
            state: body.state || "",
            pincode: body.pincode || ""
        });

        const coach = await DiabetesCoach.create({
            name: body.name.trim(),
            password: hashedPassword,
            profileImage,
            price: Number(body.price) || 0,
            phone: body.phone ? body.phone.trim() : "",
            email: body.email ? body.email.trim() : "",
            about: body.about || "",
            languages,
            location: {
                lat: Number(locationData.lat) || Number(body.lat) || 0,
                lng: Number(locationData.lng) || Number(body.lng) || 0,
                address: locationData.address || body.address || "",
                city: locationData.city || body.city || "",
                state: locationData.state || body.state || "",
                pincode: locationData.pincode || body.pincode || ""
            },
            isActive: true
        });

        // Response mein password leak na ho
        const coachResponse = coach.toObject();
        delete coachResponse.password;

        res.status(201).json({
            success: true,
            message: "Diabetes Coach created successfully!",
            data: coachResponse
        });
    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📋 2. GET ALL COACHES (ADMIN TABLE LIST WITH SEARCH & FILTERS)
// Endpoint: GET /admin/cgm/coaches/all
// =========================================================================
const getAllCoaches = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            city, 
            activeOnly 
        } = req.query;

        const query = {};
        if (activeOnly === 'true') query.isActive = true;
        if (city && city.trim() !== '') {
            query['location.city'] = { $regex: city.trim(), $options: 'i' };
        }

        // Search by Name, Phone, Email, or City
        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { phone: regex },
                { email: regex },
                { 'location.city': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await DiabetesCoach.countDocuments(query);

        // Sensitive credentials (-password -token -fcmToken) exclude karein
        const coaches = await DiabetesCoach.find(query)
            .select('-password -token -fcmToken')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Admin Table ke liye clean lightweight format
        const formattedCoaches = coaches.map(coach => ({
            _id: coach._id,
            name: coach.name,
            profileImage: coach.profileImage || null,
            price: coach.price || 0,
            phone: coach.phone || "N/A",
            email: coach.email || "N/A",
            languages: coach.languages || [],
            location: {
                city: coach.location?.city || "N/A",
                state: coach.location?.state || "N/A"
            },
            slotTimings: coach.slotConfig?.startTime && coach.slotConfig?.endTime 
                ? `${coach.slotConfig.startTime} - ${coach.slotConfig.endTime}` 
                : "Not Configured",
            rating: coach.rating || 4.9,
            totalReviews: coach.totalReviews || 0,
            isActive: coach.isActive,
            createdAt: coach.createdAt
        }));

        res.json({
            success: true,
            totalCoaches: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedCoaches.length,
            data: formattedCoaches
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 3. GET SINGLE COACH FULL DETAILS BY ID (VIEW MODAL / DETAIL PAGE)
// Endpoint: GET /admin/cgm/coaches/detail/:id
// =========================================================================
const getCoachById = async (req, res) => {
    try {
        const { id } = req.params;

        // Valid ID check & Fetch full details (including slotConfig and coordinates)
        const coach = await DiabetesCoach.findById(id)
            .select('-password -token -fcmToken') // Password & tokens security hide
            .lean();

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        res.json({
            success: true,
            data: coach // 👈 Returns full location (lat, lng, address), slotConfig & premiumSlots
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Update Coach (Auto-delete old image on replace & Optional Password Update)
const updateCoach = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;

        const coach = await DiabetesCoach.findById(id);
        if (!coach) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        const updateData = {};
        if (body.name) updateData.name = body.name.trim();
        if (body.price !== undefined) updateData.price = Number(body.price);
        if (body.phone !== undefined) updateData.phone = body.phone.trim();
        if (body.email !== undefined) updateData.email = body.email.trim();
        if (body.about !== undefined) updateData.about = body.about;
        if (body.languages) updateData.languages = safeParse(body.languages, coach.languages);

        // 🔐 Optional Password Update
        if (body.password && body.password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(body.password.trim(), salt);
        }

        // Location Update
        if (body.location || body.lat || body.lng || body.city || body.address) {
            const loc = safeParse(body.location, coach.location || {});
            updateData.location = {
                lat: body.lat !== undefined ? Number(body.lat) : (loc.lat !== undefined ? Number(loc.lat) : coach.location?.lat),
                lng: body.lng !== undefined ? Number(body.lng) : (loc.lng !== undefined ? Number(loc.lng) : coach.location?.lng),
                address: body.address !== undefined ? body.address : (loc.address || coach.location?.address),
                city: body.city !== undefined ? body.city : (loc.city || coach.location?.city),
                state: body.state !== undefined ? body.state : (loc.state || coach.location?.state),
                pincode: body.pincode !== undefined ? body.pincode : (loc.pincode || coach.location?.pincode)
            };
        }

        // Image Replacement & Old Image Cleanup
        if (req.file) {
            if (coach.profileImage) removeOldFile(coach.profileImage);
            updateData.profileImage = `/uploads/diabetes_coaches/${req.file.filename}`;
        }

        const updated = await DiabetesCoach.findByIdAndUpdate(
            id, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        ).select('-password');

        res.json({
            success: true,
            message: "Coach details updated successfully!",
            data: updated
        });
    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Delete Coach (With Image Cleanup)
const deleteCoach = async (req, res) => {
    try {
        const { id } = req.params;
        const coach = await DiabetesCoach.findById(id);

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        if (coach.profileImage) removeOldFile(coach.profileImage);
        await DiabetesCoach.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "Coach and profile photo deleted permanently."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. Toggle Active Status
const toggleCoachStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const coach = await DiabetesCoach.findById(id);

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        coach.isActive = !coach.isActive;
        await coach.save();

        res.json({
            success: true,
            message: `Coach is now ${coach.isActive ? 'Active' : 'Inactive'}`,
            isActive: coach.isActive,
            data: coach
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};





module.exports = {
    createCoach,
    getAllCoaches,
    getCoachById,
    updateCoach,
    deleteCoach,
    toggleCoachStatus
};