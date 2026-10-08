// controllers/coach/authCoachController.js

const DiabetesCoach = require('../../models/DiabetesCoach');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper to remove old file on error
const { deleteFile } = require('../../utils/fileHandler');
const removeOldFile = (filePath) => {
    if (!filePath) return;
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const publicPath = cleanPath.startsWith('public') ? cleanPath : `public/${cleanPath}`;
    deleteFile(publicPath);
};

// Safe JSON Parser
const safeParse = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
};

// 1. Direct Coach Registration (Phone ya Email mein se koi ek required)
const registerCoach = async (req, res) => {
    try {
        const body = req.body;

        if (!body.name || body.price === undefined || !body.password) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "Name, price, and password are required." 
            });
        }

        const phone = body.phone && body.phone.trim() !== '' ? body.phone.trim() : null;
        const email = body.email && body.email.trim() !== '' ? body.email.toLowerCase().trim() : null;

        // Check: Dono me se kam se kam ek hona chahiye
        if (!phone && !email) {
            if (req.file) removeOldFile(req.file.path);
            return res.status(400).json({ 
                success: false, 
                message: "Please provide at least a Phone number or an Email address." 
            });
        }

        // Duplicate check (Sirf wahi check karein jo user ne provide kiya hai)
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

        const newCoach = await DiabetesCoach.create({
            name: body.name.trim(),
            password: hashedPassword,
            phone,
            email,
            price: Number(body.price) || 0,
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

        // 🎟️ Generate JWT Token
        const token = jwt.sign(
            { id: newCoach._id, role: 'diabetes-coach' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        newCoach.token = token;
        await newCoach.save();

        const coachData = newCoach.toObject();
        delete coachData.password;

        res.status(201).json({
            success: true,
            message: "Diabetic Coach registered successfully!",
            token,
            data: coachData
        });

    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. Direct Coach Login (Phone ya Email dono se login support)
const loginCoach = async (req, res) => {
    try {
        const { username, email, phone, password, fcmToken } = req.body;

        // username, email ya phone kisi bhi key se input accept karega
        const identifier = (username || email || phone || "").trim();

        if (!identifier || !password) {
            return res.status(400).json({ 
                success: false, 
                message: "Phone or Email and password are required." 
            });
        }

        // Search by phone OR email
        const coach = await DiabetesCoach.findOne({
            $or: [
                { phone: identifier },
                { email: identifier.toLowerCase() }
            ]
        }).select('+password');

        if (!coach) {
            return res.status(401).json({ success: false, message: "Invalid credentials." });
        }

        if (coach.isActive === false) {
            return res.status(403).json({ success: false, message: "Your coach account is deactivated." });
        }

        // Verify Password
        const isMatch = await bcrypt.compare(password.trim(), coach.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Invalid credentials." });
        }

        // Generate JWT Token
        const token = jwt.sign(
            { id: coach._id, role: 'diabetes-coach' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        coach.token = token;
        if (fcmToken) coach.fcmToken = fcmToken;
        await coach.save();

        const coachData = coach.toObject();
        delete coachData.password;

        res.json({
            success: true,
            message: "Login successful!",
            token,
            data: coachData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};;

module.exports = {
    registerCoach,
    loginCoach
};