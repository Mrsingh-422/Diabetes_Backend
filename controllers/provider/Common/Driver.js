const Driver = require('../../../models/Driver');
const PharmacyBooking = require('../../../models/PharmacyBooking'); // 👈 Active order check ke liye
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 🔒 Helper 1: Clean Web-Friendly Image Paths (Removes 'public' and converts Windows '\\' to '/')
const formatFilePath = (filePath) => {
    if (!filePath) return null;
    let clean = filePath.replace(/\\/g, '/');
    clean = clean.replace(/^public\//, '');
    if (!clean.startsWith('/')) {
        clean = '/' + clean;
    }
    return clean;
};

// 🗑️ Helper 2: Safe Physical File Unlink from Server Storage
const removeStoredFile = (filePath) => {
    if (!filePath) return;
    let clean = filePath.replace(/\\/g, '/').replace(/^\//, '');
    if (!clean.startsWith('public/')) {
        clean = path.join('public', clean);
    }
    const fullPath = path.resolve(clean);
    if (fs.existsSync(fullPath)) {
        try {
            fs.unlinkSync(fullPath);
        } catch (err) {
            console.error("Error deleting old file:", err.message);
        }
    }
};

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// 1. REGISTER DRIVER (By Vendor)
// Endpoint: POST /provider/driver/add
// ==========================================
const registerDriver = async (req, res) => {
    try {
        const vendorId = req.user.id; 
        const { name, phone, password, username, ...details } = req.body;
        const files = req.files;

        // 🌟 FIX 1: Support clinic-pharmacy and clinic-lab to match Driver model enum ['Lab', 'Pharmacy', 'Food']
        const roleMapping = {
            'lab': 'Lab',
            'pharmacy': 'Pharmacy',
            'food': 'Food',
            'clinic-pharmacy': 'Pharmacy', // 👈 Clinic Pharmacy support
            'clinic-lab': 'Lab',           // 👈 Clinic Lab support
            'ambulance': 'Ambulance'
        };

        const rawRole = (req.user.role || '').toLowerCase();
        const vendorType = roleMapping[rawRole] || req.user.role;

        if (!['Lab', 'Pharmacy', 'Food'].includes(vendorType)) {
            return res.status(400).json({
                success: false,
                message: `Vendor type '${vendorType}' is not supported for delivery driver management.`
            });
        }

        // Validation: Required fields check
        if (!name || !phone || !password || !username) {
            return res.status(400).json({ 
                success: false, 
                message: "Name, Phone, Password, and Username are required fields." 
            });
        }

        // Duplicate Check for username and phone
        const queryConditions = [];
        if (username) queryConditions.push({ username: username.trim() });
        if (phone) queryConditions.push({ phone: phone.trim() });

        if (queryConditions.length > 0) {
            const exists = await Driver.findOne({ $or: queryConditions });
            if (exists) {
                if (username && exists.username === username.trim()) {
                    return res.status(400).json({ success: false, message: "Username already taken." });
                }
                if (phone && exists.phone === phone.trim()) {
                    return res.status(400).json({ success: false, message: "Phone number already registered." });
                }
            }
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);

        // 🌟 FIX 2: Clean image paths using formatFilePath
        const profilePicPath = files?.profilePic ? formatFilePath(files.profilePic[0].path) : null;
        const certPath = files?.certificate ? formatFilePath(files.certificate[0].path) : null;
        const licensePath = files?.license ? formatFilePath(files.license[0].path) : null;
        const rcPath = files?.rcImage ? formatFilePath(files.rcImage[0].path) : null;

        const driver = await Driver.create({
            vendorId, 
            vendorType, 
            name: name.trim(), 
            phone: phone.trim(),
            password: hashedPassword,
            username: username.trim(),
            ...details,
            profilePic: profilePicPath,
            documents: {
                certificate: certPath,
                license: licensePath,
                rcImage: rcPath
            },
            status: 'Available',
            isOnline: true,
            isActive: true
        });

        // Hide password in response
        const responseData = driver.toObject();
        delete responseData.password;

        res.status(201).json({ 
            success: true, 
            message: "Driver added successfully", 
            data: responseData 
        });
    } catch (error) { 
        console.error("Register Driver Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 2. LOGIN DRIVER (Public Mobile App Login)
// Endpoint: POST /provider/driver/login
// ==========================================
const loginDriver = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Username/Phone and Password are required." });
        }

        const cleanIdentifier = String(identifier).trim();

        const driver = await Driver.findOne({
            $or: [
                { username: cleanIdentifier },
                { phone: cleanIdentifier }
            ]
        }).select('+password');

        if (!driver || !(await bcrypt.compare(String(password), driver.password))) {
            return res.status(400).json({ success: false, message: "Invalid credentials." });
        }

        if (driver.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your driver profile is suspended. Please contact your manager." 
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && driver.token) {
            try {
                jwt.verify(driver.token, process.env.JWT_SECRET);
                token = driver.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(driver._id, 'driver');
            driver.token = token;
            await driver.save();
        }

        const responseData = driver.toObject();
        delete responseData.password;

        res.json({ 
            success: true, 
            token, 
            vendorType: driver.vendorType, 
            data: responseData 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 3. GET ALL DRIVERS (Vendor Specific + Pagination)
// Endpoint: GET /provider/driver/list?page=1
// ==========================================
const getVendorDrivers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const total = await Driver.countDocuments({ vendorId: req.user.id });
        const drivers = await Driver.find({ vendorId: req.user.id })
            .select('-password -__v')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: drivers
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 4. SEARCH DRIVERS
// Endpoint: POST /provider/driver/search
// ==========================================
const searchDrivers = async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || query.trim() === '') {
            return res.status(400).json({ success: false, message: "Search query required." });
        }

        const cleanQuery = query.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

        const drivers = await Driver.find({
            vendorId: req.user.id,
            $or: [
                { name: { $regex: cleanQuery, $options: 'i' } },
                { phone: { $regex: cleanQuery, $options: 'i' } },
                { username: { $regex: cleanQuery, $options: 'i' } }
            ]
        }).select('-password -__v').lean();

        res.json({ success: true, count: drivers.length, data: drivers });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 5. GET SINGLE DRIVER DETAILS
// Endpoint: GET /provider/driver/details/:id
// ==========================================
const getDriverById = async (req, res) => {
    try {
        const driver = await Driver.findOne({ _id: req.params.id, vendorId: req.user.id })
            .select('-password -__v')
            .lean();

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found." });
        }

        res.json({ success: true, data: driver });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 6. UPDATE DRIVER
// Endpoint: PUT /provider/driver/update/:id
// ==========================================
const updateDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const driver = await Driver.findOne({ _id: id, vendorId: req.user.id });
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found or unauthorized." });
        }

        const { password, ...updateData } = req.body;
        const files = req.files;

        if (password && String(password).trim() !== '') {
            updateData.password = await bcrypt.hash(String(password).trim(), 10);
        }

        // 🌟 Clean and Update Profile Photo
        if (files?.profilePic) {
            removeStoredFile(driver.profilePic);
            updateData.profilePic = formatFilePath(files.profilePic[0].path);
        }

        // 🌟 Clean and Update Document Images
        if (files) {
            const currentDocs = driver.documents || {};
            
            if (files.certificate) {
                removeStoredFile(currentDocs.certificate);
            }
            if (files.license) {
                removeStoredFile(currentDocs.license);
            }
            if (files.rcImage) {
                removeStoredFile(currentDocs.rcImage);
            }

            updateData.documents = {
                certificate: files.certificate ? formatFilePath(files.certificate[0].path) : currentDocs.certificate,
                license: files.license ? formatFilePath(files.license[0].path) : currentDocs.license,
                rcImage: files.rcImage ? formatFilePath(files.rcImage[0].path) : currentDocs.rcImage
            };
        }

        const updatedDriver = await Driver.findByIdAndUpdate(
            id, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        ).select('-password -__v');

        res.json({ 
            success: true, 
            message: "Driver updated successfully", 
            data: updatedDriver 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 7. DELETE DRIVER
// Endpoint: DELETE /provider/driver/delete/:id
// ==========================================
const deleteDriver = async (req, res) => {
    try {
        const driver = await Driver.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found or unauthorized." });
        }

        // 🌟 FIX 4: Active Delivery Order Check before deleting
        const activeDelivery = await PharmacyBooking.findOne({
            $or: [
                { driverId: req.params.id, status: { $in: ['Packed', 'Shipped', 'Accepted', 'OutForDelivery'] } },
                { 'returnDetails.pickupDriverId': req.params.id, 'returnDetails.pickupStatus': { $in: ['Assigned', 'OutForPickup', 'ReachedLocation'] } }
            ]
        });

        if (activeDelivery) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete driver: Driver is currently delivering/picking Order #${activeDelivery.orderId}. Please complete or reassign the order first.`
            });
        }

        // 🌟 FIX 3: Safe File Cleanup with Optional Chaining (?.)
        const filesToDelete = [
            driver.profilePic,
            driver.documents?.certificate,
            driver.documents?.license,
            driver.documents?.rcImage
        ];

        filesToDelete.forEach(file => {
            if (file) removeStoredFile(file);
        });

        await Driver.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: "Driver and associated documents deleted successfully." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 8. TOGGLE STATUS (Available / Busy / Offline)
// Endpoint: PATCH /provider/driver/status/:id
// ==========================================
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!status || !['Available', 'Busy', 'Offline'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Valid status value ('Available', 'Busy', 'Offline') is required." 
            });
        }

        const isOnline = status !== 'Offline';

        const driver = await Driver.findOneAndUpdate(
            { _id: req.params.id, vendorId: req.user.id },
            { 
                $set: { 
                    status, 
                    isOnline: Boolean(isOnline) 
                } 
            },
            { new: true }
        ).select('-password -__v');

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }

        res.json({ 
            success: true, 
            message: `Driver status successfully updated to ${status}.`, 
            isOnline: driver.isOnline,
            status: driver.status,
            data: driver 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 9. VENDOR RESET DRIVER PASSWORD
// Endpoint: PUT /provider/driver/reset-password/:id
// ==========================================
const vendorResetDriverPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        const vendorId = req.user.id;

        if (!newPassword || String(newPassword).trim() === '') {
            return res.status(400).json({ success: false, message: "New password is required." });
        }

        const hashedPassword = await bcrypt.hash(String(newPassword).trim(), 10);

        const driver = await Driver.findOneAndUpdate(
            { _id: id, vendorId: vendorId },
            { password: hashedPassword, token: null },
            { new: true }
        );

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found or you are not authorized." });
        }

        res.json({ success: true, message: "Driver password reset successfully. Driver must log in again." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 10. GET DRIVER PROFILE (Driver App)
// Endpoint: GET /provider/driver/profile
// ==========================================
const getDriverProfile = async (req, res) => {
    try {
        const driver = await Driver.findById(req.user.id)
            .select('-password -__v')
            .populate({
                path: 'vendorId',
                select: 'name email phone profileImage'
            });

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }

        res.json({ 
            success: true, 
            data: driver 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    registerDriver, 
    loginDriver, 
    getDriverProfile,
    getVendorDrivers, 
    searchDrivers, 
    getDriverById, 
    updateDriver, 
    deleteDriver,
    toggleDriverStatus,
    vendorResetDriverPassword
};