// controllers/admin/CGM/DiabetesCoachAdmin.js

const DiabetesCoach = require('../../../models/DiabetesCoach');
const { deleteFile } = require('../../../utils/fileHandler');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Helper to remove old image file from server disk
const removeOldFile = (filePath) => {
    if (!filePath) return;
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const publicPath = cleanPath.startsWith('public') ? cleanPath : `public/${cleanPath}`;
    deleteFile(publicPath);
};

// Safe JSON parser for arrays/objects sent via FormData
const safeParse = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
};

// Helper to safely parse booleans from FormData strings ("true"/"false"/undefined)
const parseBoolean = (val, defaultValue) => {
    if (val === undefined || val === null || val === '') return defaultValue;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
        const lower = val.trim().toLowerCase();
        if (lower === 'true' || lower === '1') return true;
        if (lower === 'false' || lower === '0') return false;
    }
    return defaultValue;
};
// =========================================================================
// 👨‍⚕️ 1. ADMIN CREATE COACH (With Safe Boolean Parsing)
// Endpoint: POST /admin/cgm/coaches/add
// =========================================================================
const createCoach = async (req, res) => {
    try {
        const body = req.body;

        if (!body.name || !body.password) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "Coach name and login password are required." 
            });
        }

        const phone = body.phone && body.phone.trim() !== '' ? body.phone.trim() : null;
        const email = body.email && body.email.trim() !== '' ? body.email.toLowerCase().trim() : null;

        if (!phone && !email) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "Please provide at least a Phone number or an Email address for coach login." 
            });
        }

        const duplicateConditions = [];
        if (phone) duplicateConditions.push({ phone });
        if (email) duplicateConditions.push({ email });

        const existingCoach = await DiabetesCoach.findOne({ $or: duplicateConditions });
        if (existingCoach) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "A coach with this Phone or Email already exists." 
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

        const onlineFee = body.onlineFee !== undefined ? Number(body.onlineFee) : (Number(body.price) || 299);
        const offlineFee = body.offlineFee !== undefined ? Number(body.offlineFee) : 599;

        // Safe Consultation Modes Parsing
        let modesInput = safeParse(body.consultationModes, null);
        const onlineInput = modesInput?.isOnlineAvailable !== undefined 
            ? modesInput.isOnlineAvailable 
            : (body.isOnlineAvailable !== undefined ? body.isOnlineAvailable : body['consultationModes.isOnlineAvailable']);
        const offlineInput = modesInput?.isOfflineAvailable !== undefined 
            ? modesInput.isOfflineAvailable 
            : (body.isOfflineAvailable !== undefined ? body.isOfflineAvailable : body['consultationModes.isOfflineAvailable']);

        const newCoach = await DiabetesCoach.create({
            name: body.name.trim(),
            password: hashedPassword,
            phone,
            email,
            qualification: body.qualification || "Certified Diabetes Educator",
            coachType: body.coachType || "Both",
            fees: {
                online: onlineFee,
                offline: offlineFee
            },
            price: onlineFee,
            consultationModes: {
                isOnlineAvailable: parseBoolean(onlineInput, true),
                isOfflineAvailable: parseBoolean(offlineInput, true)
            },
            profileImage,
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

        const coachData = newCoach.toObject();
        delete coachData.password;

        res.status(201).json({
            success: true,
            message: "Diabetes Coach created successfully by Admin!",
            data: coachData
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
            coachType,
            activeOnly 
        } = req.query;

        const query = {};
        if (activeOnly === 'true') query.isActive = true;
        if (coachType && coachType.trim() !== '') {
            query.coachType = { $in: [coachType.trim(), 'Both'] };
        }
        if (city && city.trim() !== '') {
            query['location.city'] = { $regex: city.trim(), $options: 'i' };
        }

        // Search by Name, Qualification, Phone, Email, or City
        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { qualification: regex },
                { phone: regex },
                { email: regex },
                { 'location.city': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await DiabetesCoach.countDocuments(query);

        // Security: Exclude sensitive credentials (-password -token -fcmToken)
        const coaches = await DiabetesCoach.find(query)
            .select('-password -token -fcmToken')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Format clean table row for Admin Dashboard
        const formattedCoaches = coaches.map(coach => ({
            _id: coach._id,
            name: coach.name,
            qualification: coach.qualification || "Certified Diabetes Educator",
            coachType: coach.coachType || "Both",
            profileImage: coach.profileImage || null,
            fees: {
                online: coach.fees?.online || coach.price || 299,
                offline: coach.fees?.offline || 599
            },
            consultationModes: coach.consultationModes || { isOnlineAvailable: true, isOfflineAvailable: true },
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
// 🔍 3. GET SINGLE COACH DETAILS BY ID (ADMIN FULL VIEW)
// Endpoint: GET /admin/cgm/coaches/detail/:id
// =========================================================================
const getCoachById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        // Return 100% full detail (excluding password/tokens)
        const coach = await DiabetesCoach.findById(id)
            .select('-password -token -fcmToken')
            .lean();

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        res.json({
            success: true,
            data: coach
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📝 4. ADMIN UPDATE COACH DETAILS (With Safe Boolean & Unchanged Field Handling)
// Endpoint: PUT /admin/cgm/coaches/update/:id
// =========================================================================
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
        if (body.phone !== undefined) updateData.phone = body.phone.trim() || null;
        if (body.email !== undefined) updateData.email = body.email.trim().toLowerCase() || null;
        if (body.about !== undefined) updateData.about = body.about;
        if (body.qualification) updateData.qualification = body.qualification;
        if (body.coachType) updateData.coachType = body.coachType; // 'Diabetes Educator', 'Diabetes Coach', 'Both'

        // Update Fees
        if (body.onlineFee !== undefined || body.offlineFee !== undefined || body.price !== undefined) {
            updateData.fees = {
                online: body.onlineFee !== undefined ? Number(body.onlineFee) : (coach.fees?.online || Number(body.price) || 299),
                offline: body.offlineFee !== undefined ? Number(body.offlineFee) : (coach.fees?.offline || 599)
            };
            updateData.price = updateData.fees.online;
        }

        // 🛡️ SAFE UPDATE FOR CONSULTATION MODES (Handles "true"/"false" strings, objects & un-sent/unchanged fields)
        let modesInput = safeParse(body.consultationModes, null);
        const onlineInput = modesInput?.isOnlineAvailable !== undefined 
            ? modesInput.isOnlineAvailable 
            : (body.isOnlineAvailable !== undefined ? body.isOnlineAvailable : body['consultationModes.isOnlineAvailable']);

        const offlineInput = modesInput?.isOfflineAvailable !== undefined 
            ? modesInput.isOfflineAvailable 
            : (body.isOfflineAvailable !== undefined ? body.isOfflineAvailable : body['consultationModes.isOfflineAvailable']);

        // Agar frontend ne touch nahi kiya, toh DB ki existing value retain rahegi
        const currentOnline = coach.consultationModes?.isOnlineAvailable ?? true;
        const currentOffline = coach.consultationModes?.isOfflineAvailable ?? true;

        // Sirf tabhi update karein jab frontend ne actually bheja ho
        if (onlineInput !== undefined || offlineInput !== undefined) {
            updateData.consultationModes = {
                isOnlineAvailable: parseBoolean(onlineInput, currentOnline),
                isOfflineAvailable: parseBoolean(offlineInput, currentOffline)
            };
        }

        if (body.languages) updateData.languages = safeParse(body.languages, coach.languages);

        // 🔐 Optional Password Reset by Admin
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

        // Image Replacement & Clean Old Photo from Disk
        if (req.file) {
            if (coach.profileImage) removeOldFile(coach.profileImage);
            updateData.profileImage = `/uploads/diabetes_coaches/${req.file.filename}`;
        }

        const updated = await DiabetesCoach.findByIdAndUpdate(
            id, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        ).select('-password -token -fcmToken');

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

// =========================================================================
// 🗑️ 5. ADMIN DELETE COACH (With Profile Photo Cleanup)
// Endpoint: DELETE /admin/cgm/coaches/delete/:id
// =========================================================================
const deleteCoach = async (req, res) => {
    try {
        const { id } = req.params;
        const coach = await DiabetesCoach.findById(id);

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        // Delete photo from disk
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

// =========================================================================
// 🔄 6. ADMIN TOGGLE ACTIVE / INACTIVE STATUS
// Endpoint: PATCH /admin/cgm/coaches/toggle-status/:id
// =========================================================================
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