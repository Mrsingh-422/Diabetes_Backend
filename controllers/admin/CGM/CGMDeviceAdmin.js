const CGMDevices = require('../../../models/CGMDevicesModel');
const DeviceCategory = require('../../../models/DeviceCategory');
const { deleteFile } = require('../../../utils/fileHandler');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx'); // For CSV / Excel Parsing

// Helper to safely delete file from 'public/uploads/...'
const removeOldFile = (filePath) => {
    if (!filePath) return;
    // Database path: "/uploads/cgm_devices/xyz.jpg"
    // fileHandler ko chahiye: "public/uploads/cgm_devices/xyz.jpg"
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const publicPath = cleanPath.startsWith('public') ? cleanPath : `public/${cleanPath}`;
    deleteFile(publicPath);
};

// Helper to safely parse JSON inputs from multipart form-data
const safeJsonParse = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try {
        return JSON.parse(data);
    } catch (err) {
        return fallback;
    }
};

// ==========================================
// 1. CREATE CGM / GLUCOMETER DEVICE
// ==========================================
const createCGMDevice = async (req, res) => {
    try {
        const body = req.body;

        // Image validation
        if (!req.files || !req.files['mainImage'] || req.files['mainImage'].length === 0) {
            return res.status(400).json({ success: false, message: "Main product image is required." });
        }

        const mainImagePath = `/uploads/cgm_devices/${req.files['mainImage'][0].filename}`;
        const galleryImagePaths = req.files['images']
            ? req.files['images'].map(file => `/uploads/cgm_devices/${file.filename}`)
            : [];

        const variants = safeJsonParse(body.variants, []);
        const specifications = safeJsonParse(body.specifications, {});
        const highlights = safeJsonParse(body.highlights, []);
        const howToUseSteps = safeJsonParse(body.howToUseSteps, []);
        const boxContents = safeJsonParse(body.boxContents, []);
        const faqs = safeJsonParse(body.faqs, []);

        const mrp = Number(body.mrp);
        const sellingPrice = Number(body.sellingPrice);
        const prepaidDiscountPrice = body.prepaidDiscountPrice ? Number(body.prepaidDiscountPrice) : sellingPrice;
        const savingsAmount = mrp > sellingPrice ? mrp - sellingPrice : 0;

        const newDevice = await CGMDevices.create({
            categoryId: body.categoryId,
            title: body.title,
            brand: body.brand || "BeatO",
            deviceModel: body.deviceModel || "Curv",
            tagline: body.tagline || "",
            badge: body.badge || "AI-Powered",

            mainImage: mainImagePath,
            images: galleryImagePaths,
            demoVideoUrl: body.demoVideoUrl || null,

            mrp,
            sellingPrice,
            prepaidDiscountPrice,
            savingsAmount,

            compatibility: body.compatibility || 'Android Only',
            connectorType: body.connectorType || 'Type-C',

            variants,
            specifications,
            highlights,

            description: body.description,
            howToUseSteps,
            boxContents,
            faqs,

            stockQuantity: body.stockQuantity ? Number(body.stockQuantity) : 100,
            isAvailable: body.isAvailable !== 'false',
            isFeatured: body.isFeatured === 'true' || body.isFeatured === true,
            isPopular: body.isPopular === 'true' || body.isPopular === true,
            isActive: true,
            totalUsersCountDisplay: body.totalUsersCountDisplay || "8 Lakh+ Users"
        });

        res.status(201).json({
            success: true,
            message: "CGM Device / Product created successfully!",
            data: newDevice
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET ALL DEVICES (Paginated + Filter + Search)
// ==========================================
const getAllCGMDevices = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", categoryId, activeOnly } = req.query;

        const query = {};
        if (activeOnly === 'true') query.isActive = true;
        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) query.categoryId = categoryId;

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { title: regex },
                { brand: regex },
                { deviceModel: regex }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const totalDocs = await CGMDevices.countDocuments(query);

        const devices = await CGMDevices.find(query)
            .populate('categoryId', 'name')
            .skip(skip)
            .limit(parseInt(limit, 10))
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / parseInt(limit, 10)) || 1,
            currentPage: parseInt(page, 10),
            count: devices.length,
            data: devices
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET SINGLE DEVICE BY ID
// ==========================================
const getCGMDeviceById = async (req, res) => {
    try {
        const { id } = req.params;
        const device = await CGMDevices.findById(id).populate('categoryId', 'name description');

        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found." });
        }

        res.json({ success: true, data: device });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UPDATE DEVICE DETAILS (WITH AUTO OLD IMAGES CLEANUP)
// ==========================================
const updateCGMDevice = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;

        const device = await CGMDevices.findById(id);
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found." });
        }

        const updateData = { ...body };

        // 🗑️ Handle Main Image Replacement & Delete Old File
        if (req.files && req.files['mainImage'] && req.files['mainImage'].length > 0) {
            if (device.mainImage) {
                removeOldFile(device.mainImage); // Purani main photo disk se delete
            }
            updateData.mainImage = `/uploads/cgm_devices/${req.files['mainImage'][0].filename}`;
        }

        // 🗑️ Handle Gallery Images Replacement & Delete Old Files
        if (req.files && req.files['images'] && req.files['images'].length > 0) {
            if (device.images && device.images.length > 0) {
                device.images.forEach(oldImg => removeOldFile(oldImg)); // Purani gallery photos disk se delete
            }
            updateData.images = req.files['images'].map(file => `/uploads/cgm_devices/${file.filename}`);
        }

        // Parse nested JSON structures safely
        if (body.variants) updateData.variants = safeJsonParse(body.variants, device.variants);
        if (body.specifications) updateData.specifications = safeJsonParse(body.specifications, device.specifications);
        if (body.highlights) updateData.highlights = safeJsonParse(body.highlights, device.highlights);
        if (body.howToUseSteps) updateData.howToUseSteps = safeJsonParse(body.howToUseSteps, device.howToUseSteps);
        if (body.boxContents) updateData.boxContents = safeJsonParse(body.boxContents, device.boxContents);
        if (body.faqs) updateData.faqs = safeJsonParse(body.faqs, device.faqs);

        if (body.mrp || body.sellingPrice) {
            const mrp = body.mrp ? Number(body.mrp) : device.mrp;
            const sellingPrice = body.sellingPrice ? Number(body.sellingPrice) : device.sellingPrice;
            updateData.savingsAmount = mrp > sellingPrice ? mrp - sellingPrice : 0;
        }

        const updated = await CGMDevices.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('categoryId', 'name');

        res.json({
            success: true,
            message: "CGM Device details updated successfully (Old media cleaned)!",
            data: updated
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. DELETE DEVICE (WITH ALL MEDIA FILES CLEANUP)
// ==========================================
const deleteCGMDevice = async (req, res) => {
    try {
        const { id } = req.params;
        const device = await CGMDevices.findById(id);

        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found." });
        }

        // 🗑️ Delete all associated files from server disk
        if (device.mainImage) {
            removeOldFile(device.mainImage);
        }
        if (device.images && Array.isArray(device.images)) {
            device.images.forEach(img => removeOldFile(img));
        }

        await CGMDevices.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "Device and its media files permanently deleted from server."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. TOGGLE ACTIVE STATUS SWITCH
// ==========================================
const toggleCGMDeviceActive = async (req, res) => {
    try {
        const { id } = req.params;
        const device = await CGMDevices.findById(id);

        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found." });
        }

        device.isActive = !device.isActive;
        await device.save();

        res.json({
            success: true,
            message: `Device has been ${device.isActive ? 'Activated' : 'Deactivated'}.`,
            isActive: device.isActive,
            data: device
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 7. 🚀 BULK IMPORT CGM DEVICES VIA CSV / EXCEL
// Full Path: POST /admin/cgm/devices/bulk-import-csv
// ==========================================
const importCGMDevicesCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload a CSV or Excel file (Key: 'file')." });
        }

        const filePath = req.file.path;
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!rows || rows.length === 0) {
            removeOldFile(filePath);
            return res.status(400).json({ success: false, message: "The uploaded CSV/Excel file is empty." });
        }

        const categoriesMap = new Map();
        const allCategories = await DeviceCategory.find();
        allCategories.forEach(cat => {
            categoriesMap.set(cat.name.toLowerCase().trim(), cat._id);
        });

        const devicesToInsert = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // Excel row number (1-based + 1 for header)

            if (!row.title || !row.mrp || !row.sellingPrice) {
                errors.push(`Row ${rowNum}: Title, MRP, and Selling Price are required.`);
                continue;
            }

            // Find or Auto-Map Category
            let categoryId = null;
            if (row.categoryId && mongoose.Types.ObjectId.isValid(row.categoryId)) {
                categoryId = row.categoryId;
            } else if (row.categoryName) {
                const catKey = row.categoryName.toLowerCase().trim();
                if (categoriesMap.has(catKey)) {
                    categoryId = categoriesMap.get(catKey);
                } else {
                    // Create Category automatically if doesn't exist
                    const newCat = await DeviceCategory.create({ name: row.categoryName.trim() });
                    categoryId = newCat._id;
                    categoriesMap.set(catKey, newCat._id);
                }
            }

            if (!categoryId) {
                // Fallback to first existing category
                const defaultCat = allCategories[0] || (await DeviceCategory.create({ name: "Glucometers" }));
                categoryId = defaultCat._id;
            }

            const mrp = Number(row.mrp) || 0;
            const sellingPrice = Number(row.sellingPrice) || 0;
            const savingsAmount = mrp > sellingPrice ? mrp - sellingPrice : 0;

            devicesToInsert.push({
                categoryId,
                title: String(row.title).trim(),
                brand: row.brand ? String(row.brand).trim() : "BeatO",
                deviceModel: row.deviceModel || "Curv",
                tagline: row.tagline || "CDSCO Approved Lab-Grade Accuracy | ISO Certified",
                badge: row.badge || "AI-Powered",
                mainImage: row.mainImage || "/uploads/cgm_devices/default_device.png",
                images: row.images ? row.images.split(',').map(s => s.trim()) : [],
                demoVideoUrl: row.demoVideoUrl || null,

                mrp,
                sellingPrice,
                prepaidDiscountPrice: row.prepaidDiscountPrice ? Number(row.prepaidDiscountPrice) : sellingPrice,
                savingsAmount,

                compatibility: row.compatibility || 'Android Only',
                connectorType: row.connectorType || 'Type-C',

                description: row.description || String(row.title).trim(),
                stockQuantity: row.stockQuantity ? Number(row.stockQuantity) : 100,
                totalUsersCountDisplay: row.totalUsersCountDisplay || "8 Lakh+ Users",
                isAvailable: true,
                isActive: true
            });
        }

        let insertedDocs = [];
        if (devicesToInsert.length > 0) {
            insertedDocs = await CGMDevices.insertMany(devicesToInsert);
        }

        // Delete uploaded temp CSV file
        removeOldFile(filePath);

        res.status(201).json({
            success: true,
            message: `Successfully imported ${insertedDocs.length} devices from CSV!`,
            totalRowsProcessed: rows.length,
            importedCount: insertedDocs.length,
            failedCount: errors.length,
            errors: errors.length > 0 ? errors : undefined,
            data: insertedDocs
        });

    } catch (error) {
        if (req.file) removeOldFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCGMDevice,
    getAllCGMDevices,
    getCGMDeviceById,
    updateCGMDevice,
    deleteCGMDevice,
    toggleCGMDeviceActive,
    importCGMDevicesCSV // 👈 Export Added
};