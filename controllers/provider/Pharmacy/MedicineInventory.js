// controllers/provider/Pharmacy/MedicineInventory.js

const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');
const MasterRequest = require('../../../models/MasterRequest');
const mongoose = require('mongoose');

// Helper to escape regex special characters (e.g. "+", "(", ")")
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// =========================================================================
// 1. Search Master Medicine Database (Inventory me add karne ke liye)
// Endpoint: GET /provider/pharmacy/inventory/getMaster?query=dolo&page=1
// =========================================================================
const searchMasterMedicines = async (req, res) => {
    try {
        const { query, page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;
        const skip = (pageNum - 1) * limitNum;

        let filter = {};
        if (query && query.trim() !== '') {
            const sanitized = escapeRegex(query.trim()); // 👈 Fixed: Safe regex
            const regex = new RegExp(sanitized, 'i');
            filter = {
                $or: [
                    { name: regex },
                    { salt_composition: regex },
                    { manufacturers: regex }
                ]
            };
        }

        const medicines = await Medicine.find(filter)
            .select('name manufacturers salt_composition packaging mrp image_url prescription_required')
            .skip(skip)
            .limit(limitNum)
            .sort({ name: 1 })
            .lean();

        const total = await Medicine.countDocuments(filter);

        res.json({
            success: true,
            total,
            currentPage: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            data: medicines
        });
    } catch (error) {
        console.error("searchMasterMedicines error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. Get Single Master Medicine Details By ID
// Endpoint: GET /provider/pharmacy/inventory/getMaster/details/:id
// =========================================================================
const getMasterMedicineById = async (req, res) => {
    try {
        const { id } = req.params;

        // 👈 Fixed: Valid ObjectId Check
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Medicine ID format." });
        }

        const medicine = await Medicine.findById(id).lean();
        if (!medicine) {
            return res.status(404).json({ success: false, message: "Medicine not found in master list" });
        }

        res.json({ success: true, data: medicine });
    } catch (error) {
        console.error("getMasterMedicineById error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 3. Add Medicine Batch to Pharmacy Inventory
// Endpoint: POST /provider/pharmacy/inventory/add
// =========================================================================
const addToInventory = async (req, res) => {
    try {
        const { medicineId, vendor_price, stock_quantity, expiry_date, batch_number, hsn_number } = req.body;
        const pharmacyId = req.user?.id || req.user?._id;

        if (!medicineId || !mongoose.Types.ObjectId.isValid(medicineId)) {
            return res.status(400).json({ success: false, message: "A valid medicineId is required." });
        }

        if (!batch_number || batch_number.trim() === "") {
            return res.status(400).json({ success: false, message: "Batch number is required to register medicine inventory." });
        }

        if (vendor_price === undefined || vendor_price === null || isNaN(vendor_price)) {
            return res.status(400).json({ success: false, message: "Valid vendor_price is required." });
        }

        const qty = Math.max(0, Number(stock_quantity) || 0);

        // Check if medicine exists in master list
        const medicineExists = await Medicine.findById(medicineId).lean();
        if (!medicineExists) {
            return res.status(404).json({ success: false, message: "Medicine does not exist in master catalog." });
        }

        // Upsert by pharmacyId + medicineId + batch_number
        const inventoryItem = await MedicineInventory.findOneAndUpdate(
            { 
                pharmacyId, 
                medicineId, 
                batch_number: batch_number.trim() 
            },
            { 
                $set: {
                    vendor_price: Number(vendor_price), 
                    stock_quantity: qty, 
                    expiry_date: expiry_date ? new Date(expiry_date) : null, 
                    hsn_number: hsn_number ? hsn_number.trim() : null,
                    is_available: qty > 0 
                }
            },
            { upsert: true, new: true, runValidators: true }
        );

        res.status(201).json({ 
            success: true, 
            message: "Medicine batch added to your store!", 
            data: inventoryItem 
        });
    } catch (error) {
        console.error("addToInventory error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 4. Get My Entire Inventory
// Endpoint: GET /provider/pharmacy/inventory/my-list
// =========================================================================
const getMyInventory = async (req, res) => {
    try {
        const pharmacyId = req.user?.id || req.user?._id;

        const list = await MedicineInventory.find({ pharmacyId })
            .populate('medicineId', 'name manufacturers image_url salt_composition mrp packaging prescription_required')
            .sort({ updatedAt: -1 })
            .lean();

        res.status(200).json({ 
            success: true, 
            count: list.length, 
            data: list 
        });
    } catch (error) {
        console.error("getMyInventory error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 5. Get My Non-Prescription (OTC) Inventory
// Endpoint: GET /provider/pharmacy/inventory/my-otc-list
// =========================================================================
const getMyNonPrescriptionInventory = async (req, res) => {
    try {
        const pharmacyId = req.user?.id || req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(pharmacyId)) {
            return res.status(400).json({ success: false, message: "Invalid Pharmacy ID format." });
        }

        const list = await MedicineInventory.aggregate([
            {
                $match: {
                    pharmacyId: new mongoose.Types.ObjectId(String(pharmacyId))
                }
            },
            {
                $lookup: {
                    from: "medicines", 
                    localField: "medicineId",
                    foreignField: "_id",
                    as: "medicineDetails"
                }
            },
            {
                $unwind: "$medicineDetails"
            },
            {
                $match: {
                    $or: [
                        { "medicineDetails.prescription_required": { $regex: /^(no|false)$/i } },
                        { "medicineDetails.prescription_required": { $exists: false } },
                        { "medicineDetails.prescription_required": null }
                    ]
                }
            },
            {
                $project: {
                    _id: 1,
                    pharmacyId: 1,
                    vendor_price: 1,
                    stock_quantity: 1,
                    expiry_date: 1,
                    is_available: 1,
                    batch_number: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    medicineId: {
                        _id: "$medicineDetails._id",
                        name: "$medicineDetails.name",
                        manufacturers: "$medicineDetails.manufacturers",
                        image_url: "$medicineDetails.image_url",
                        salt_composition: "$medicineDetails.salt_composition",
                        mrp: "$medicineDetails.mrp",
                        prescription_required: "$medicineDetails.prescription_required"
                    }
                }
            },
            {
                $sort: { updatedAt: -1 }
            }
        ]);

        res.status(200).json({ success: true, count: list.length, data: list });
    } catch (error) {
        console.error("getMyNonPrescriptionInventory error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 6. Update Inventory Item (Price & Stock)
// Endpoint: PUT /provider/pharmacy/inventory/update/:id
// =========================================================================
const updateInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { vendor_price, stock_quantity } = req.body;
        const pharmacyId = req.user?.id || req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Inventory ID format." });
        }

        const updateData = {};
        
        if (vendor_price !== undefined) {
            updateData.vendor_price = Number(vendor_price);
        }
        
        if (stock_quantity !== undefined) {
            const qty = Math.max(0, Number(stock_quantity));
            updateData.stock_quantity = qty;
            updateData.is_available = qty > 0; 
        }

        const updated = await MedicineInventory.findOneAndUpdate(
            { _id: id, pharmacyId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ 
                success: false, 
                message: "Medicine not found in your inventory or unauthorized" 
            });
        }

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("updateInventoryItem error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 7. Delete Inventory Item
// Endpoint: DELETE /provider/pharmacy/inventory/delete/:id
// =========================================================================
const deleteInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;
        const pharmacyId = req.user?.id || req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Inventory ID format." });
        }
        
        const deleted = await MedicineInventory.findOneAndDelete({
            _id: id,
            pharmacyId
        });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Medicine not found in your inventory or unauthorized" });
        }

        res.status(200).json({ success: true, message: "Medicine removed from your inventory successfully!" });
    } catch (error) {
        console.error("deleteInventoryItem error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 8. Request New Medicine Add to Master Catalog
// Endpoint: POST /provider/pharmacy/inventory/request-add
// =========================================================================
const requestNewMedicineAdd = async (req, res) => {
    try {
        const pharmacyId = req.user?.id || req.user?._id;
        const { name, manufacturers, salt_composition, packaging, mrp, best_price, description, prescription_required, image_url } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ success: false, message: "Medicine name is required" });
        }

        const medicineData = {
            name: name.trim(),
            manufacturers: manufacturers || "",
            salt_composition: salt_composition || "",
            packaging: packaging || "",
            mrp: mrp ? String(mrp) : "",
            best_price: best_price ? String(best_price) : "",
            description: description || "",
            prescription_required: prescription_required || "No",
            image_url: Array.isArray(image_url) ? image_url : (image_url ? [image_url] : [])
        };

        const newRequest = await MasterRequest.create({
            vendorId: pharmacyId,
            vendorType: 'Pharmacy',
            requestType: 'Medicine',
            data: medicineData
        });

        res.status(201).json({ 
            success: true, 
            message: "Request to add new medicine submitted successfully!", 
            data: newRequest 
        });
    } catch (error) {
        console.error("requestNewMedicineAdd error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    searchMasterMedicines, 
    getMasterMedicineById, 
    addToInventory, 
    getMyInventory, 
    getMyNonPrescriptionInventory,
    updateInventoryItem,
    deleteInventoryItem,
    requestNewMedicineAdd
};