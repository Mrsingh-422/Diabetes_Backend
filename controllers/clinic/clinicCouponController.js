// controllers/clinic/clinicCouponController.js
const Coupon = require('../../models/Coupon');

// 1. CREATE COUPON (Admin, Clinic, or Independent Ambulance)
const createAmbulanceCoupon = async (req, res) => {
    try {
        const creatorId = req.user.id;
        const userRole = req.user.role; // 'admin', 'superadmin', 'clinic', 'ambulance'
        const isAdmin = ['admin', 'superadmin'].includes(userRole);

        const {
            couponName,
            discountPercentage,
            maxDiscount,
            minOrderAmount = 0,
            maxUsagePerUser = 1,
            startDate,
            expiryDate,
            vendorType: bodyVendorType
        } = req.body;

        if (!couponName || !discountPercentage || !maxDiscount || !expiryDate) {
            return res.status(400).json({ success: false, message: "couponName, discountPercentage, maxDiscount, and expiryDate are required." });
        }

        const cleanName = couponName.toUpperCase().trim();
        const existing = await Coupon.findOne({ couponName: cleanName });
        if (existing) {
            return res.status(400).json({ success: false, message: `Coupon code '${cleanName}' already exists.` });
        }

        // 🎯 VENDOR TYPE & ROLE RESOLUTION:
        let finalVendorType = 'Ambulance';
        let finalVendorId = req.user.id;

        if (isAdmin) {
            finalVendorType = bodyVendorType || 'Ambulance'; // Admin can choose 'Ambulance', 'Clinic', or 'All'
            finalVendorId = null;
        } else if (userRole === 'clinic') {
            // Clinic creates for its clinic and clinic-ambulances
            finalVendorType = 'Clinic';
            finalVendorId = req.user.id;
        } else if (userRole === 'ambulance') {
            // Independent Ambulance creates for its own vehicle
            finalVendorType = 'Ambulance';
            finalVendorId = req.user.id;
        }

        const coupon = await Coupon.create({
            creatorId,
            isAdminCreated: isAdmin,
            vendorId: finalVendorId,
            vendorType: finalVendorType,
            couponName: cleanName,
            discountPercentage: Number(discountPercentage),
            maxDiscount: Number(maxDiscount),
            minOrderAmount: Number(minOrderAmount),
            maxUsagePerUser: Number(maxUsagePerUser),
            startDate: startDate ? new Date(startDate) : new Date(),
            expiryDate: new Date(expiryDate),
            isActive: true
        });

        res.status(201).json({
            success: true,
            message: `${finalVendorType} coupon created successfully.`,
            data: coupon
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET MY COUPONS (Clinic or Independent Ambulance Panel)
const getMyCoupons = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        let query = {};

        if (userRole === 'clinic') {
            // Clinic dekhega: Apne Clinic coupons + Admin ke (Clinic/Ambulance/All)
            query.$or = [
                { vendorId: userId, vendorType: 'Clinic' },
                { isAdminCreated: true, vendorType: { $in: ['Clinic', 'Ambulance', 'All'] } }
            ];
        } else if (userRole === 'ambulance') {
            // Independent Ambulance dekhega: Apne banaye coupons + Admin ke (Ambulance/All)
            query.$or = [
                { vendorId: userId, vendorType: 'Ambulance' },
                { isAdminCreated: true, vendorType: { $in: ['Ambulance', 'All'] } }
            ];
        } else {
            // Admin sees all
            query = {};
        }

        const coupons = await Coupon.find(query).sort({ createdAt: -1 });

        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. UPDATE / DELETE / TOGGLE
const updateAmbulanceCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        const filter = isAdmin ? { _id: id } : { _id: id, creatorId: req.user.id };
        const coupon = await Coupon.findOneAndUpdate(filter, { $set: req.body }, { new: true });

        if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });

        res.json({ success: true, message: "Coupon updated successfully.", data: coupon });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const toggleAmbulanceCouponStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        const filter = isAdmin ? { _id: id } : { _id: id, creatorId: req.user.id };
        const coupon = await Coupon.findOne(filter);

        if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });

        coupon.isActive = !coupon.isActive;
        await coupon.save();

        res.json({ success: true, message: `Coupon is now ${coupon.isActive ? 'Active' : 'Inactive'}.`, isActive: coupon.isActive });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteAmbulanceCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        const filter = isAdmin ? { _id: id } : { _id: id, creatorId: req.user.id };
        const coupon = await Coupon.findOneAndDelete(filter);

        if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found or unauthorized." });

        res.json({ success: true, message: "Coupon deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createAmbulanceCoupon,
    getMyCoupons,
    updateAmbulanceCoupon,
    toggleAmbulanceCouponStatus,
    deleteAmbulanceCoupon
};