const Coupon = require('../../../models/Coupon');

// Helper: Normalize Role to match Coupon Enum ['Lab', 'Pharmacy', 'Food', 'Ambulance', 'Doctor', 'Clinic', 'All']
const normalizeVendorType = (user) => {
    if (!user) return 'Clinic';
    if (user.role) {
        const r = user.role.toLowerCase();
        if (r === 'clinic') return 'Clinic';
        if (r === 'doctor' || r === 'clinic-doctor') return 'Doctor';
        if (r === 'food') return 'Food';
        if (r === 'lab') return 'Lab';
        if (r === 'pharmacy') return 'Pharmacy';
        if (r === 'ambulance' || r === 'clinic-ambulance') return 'Ambulance';
    }
    return 'Clinic';
};

// ==========================================
// 1. CREATE VENDOR / CLINIC COUPON
// Endpoint: POST /provider/coupons/add OR /api/clinic/coupons/add
// ==========================================
const createCoupon = async (req, res) => {
    try {
        const { couponName, discountPercentage, maxDiscount, expiryDate, minOrderAmount, maxUsagePerUser, startDate } = req.body;

        if (!couponName || !discountPercentage || !maxDiscount || !expiryDate) {
            return res.status(400).json({ success: false, message: "Please provide all required fields: couponName, discountPercentage, maxDiscount, expiryDate." });
        }

        if (Number(discountPercentage) > 100 || Number(discountPercentage) <= 0) {
            return res.status(400).json({ success: false, message: "Discount percentage must be between 1 and 100." });
        }

        if (new Date(expiryDate) <= new Date()) {
            return res.status(400).json({ success: false, message: "Expiry date must be a future date." });
        }

        const vendorType = normalizeVendorType(req.user);

        const coupon = await Coupon.create({ 
            creatorId: req.user.id,
            vendorId: req.user.id, 
            vendorType: vendorType, // Automatically sets 'Clinic'
            isAdminCreated: false,
            couponName: couponName.trim().toUpperCase(),
            discountPercentage: Number(discountPercentage),
            maxDiscount: Number(maxDiscount),
            minOrderAmount: minOrderAmount ? Number(minOrderAmount) : 0,
            maxUsagePerUser: maxUsagePerUser ? Number(maxUsagePerUser) : 1,
            startDate: startDate ? new Date(startDate) : new Date(),
            expiryDate: new Date(expiryDate),
            isActive: true
        });

        res.status(201).json({ success: true, message: "Coupon created successfully", data: coupon });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Coupon code already exists. Please use a unique name." });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. LIST MY COUPONS (Clinic's Own + Admin Global Coupons)
// Endpoint: GET /provider/coupons/list OR /api/clinic/coupons/list
// ==========================================
const getMyCoupons = async (req, res) => {
    try {
        const vendorType = normalizeVendorType(req.user);

        const list = await Coupon.find({ 
            $or: [
                { vendorId: req.user.id }, // Clinic's own coupons
                { 
                    isAdminCreated: true, 
                    vendorType: { $in: [vendorType, 'All'] } // Global Admin coupons for Clinic & All
                }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, count: list.length, data: list });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 3. TOGGLE COUPON STATUS (Active / Inactive)
// Endpoint: PATCH /provider/coupons/toggle/:id
// ==========================================
const toggleCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });
        
        coupon.isActive = !coupon.isActive;
        await coupon.save();

        res.json({ success: true, message: `Coupon is now ${coupon.isActive ? 'Active' : 'Inactive'}`, isActive: coupon.isActive });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 4. UPDATE COUPON
// Endpoint: PUT /provider/coupons/update/:id
// ==========================================
const updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        let coupon = await Coupon.findOne({ _id: id, vendorId: req.user.id });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });
        }

        const fieldsToUpdate = ['couponName', 'discountPercentage', 'maxDiscount', 'minOrderAmount', 'maxUsagePerUser', 'startDate', 'expiryDate', 'isActive'];
        
        fieldsToUpdate.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'couponName') {
                    coupon[field] = req.body[field].trim().toUpperCase();
                } else {
                    coupon[field] = req.body[field];
                }
            }
        });

        const updatedCoupon = await coupon.save();
        res.json({ success: true, message: "Coupon updated successfully", data: updatedCoupon });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Coupon name already exists." });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. DELETE COUPON
// Endpoint: DELETE /provider/coupons/delete/:id
// ==========================================
const deleteCoupon = async (req, res) => {
    try {
        const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, vendorId: req.user.id });
        if (!deleted) return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });
        res.json({ success: true, message: "Coupon deleted successfully" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 6. ADMIN: CREATE GLOBAL COUPON
// ==========================================
const createAdminCoupon = async (req, res) => {
    try {
        const { vendorType, couponName, ...couponDetails } = req.body; 

        const allowedTypes = ['Lab', 'Pharmacy', 'Food', 'Ambulance', 'Doctor', 'Clinic', 'All']; // 👈 Added 'Clinic'
        if (!allowedTypes.includes(vendorType)) {
            return res.status(400).json({ success: false, message: "Invalid Vendor Type selected" });
        }

        const coupon = await Coupon.create({ 
            creatorId: req.user.id,
            vendorType: vendorType, 
            vendorId: null,          
            isAdminCreated: true,
            couponName: couponName.trim().toUpperCase(),    
            ...couponDetails 
        });

        res.status(201).json({ success: true, message: "Admin coupon created successfully", data: coupon });
    } catch (error) { 
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Coupon code already exists." });
        }
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 7. Admin List All Admin-Created Coupons
const getAdminCoupons = async (req, res) => {
    try {
        const list = await Coupon.find({ isAdminCreated: true }).sort({ createdAt: -1 });
        res.json({ success: true, count: list.length, data: list });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 8. Admin Toggle
const toggleAdminCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ _id: req.params.id, isAdminCreated: true });
        if (!coupon) return res.status(404).json({ success: false, message: "Admin Coupon not found" });
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.json({ success: true, message: "Admin coupon status updated", isActive: coupon.isActive });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 9. Admin Update
const updateAdminCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        let coupon = await Coupon.findOne({ _id: id, isAdminCreated: true });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Admin Coupon not found" });
        }

        const fieldsToUpdate = [
            'vendorType', 'couponName', 'discountPercentage', 'maxDiscount', 
            'minOrderAmount', 'maxUsagePerUser', 'startDate', 'expiryDate', 'isActive'
        ];

        fieldsToUpdate.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'couponName') {
                    coupon[field] = req.body[field].trim().toUpperCase();
                } else {
                    coupon[field] = req.body[field];
                }
            }
        });

        const updatedCoupon = await coupon.save();

        res.json({ 
            success: true, 
            message: "Admin Global Coupon updated successfully", 
            data: updatedCoupon 
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: `Coupon name '${req.body.couponName}' already exists. Please use a unique name.` 
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// 10. Admin Delete
const deleteAdminCoupon = async (req, res) => {
    try {
        const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, isAdminCreated: true });
        if (!deleted) return res.status(404).json({ success: false, message: "Admin Coupon not found" });
        res.json({ success: true, message: "Admin Coupon deleted successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 11. Public Enum Dropdown Types
const getCouponEnumTypes = async (req, res) => {
    try {
        const enumValues = await Coupon.schema.path('vendorType').enumValues;
        const filteredTypes = enumValues.filter(type => type !== 'Admin');
        res.status(200).json({ 
            success: true, 
            data: filteredTypes // Returns: ["Lab", "Pharmacy", "Food", "Ambulance", "Doctor", "Clinic", "All"]
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCoupon,
    getMyCoupons,
    toggleCoupon,
    updateCoupon,
    deleteCoupon,
    createAdminCoupon,
    getAdminCoupons,
    toggleAdminCoupon,
    updateAdminCoupon,
    deleteAdminCoupon,
    getCouponEnumTypes
};