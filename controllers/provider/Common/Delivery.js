// controllers/provider/Common/Delivery.js

const DeliveryCharge = require('../../../models/DeliveryCharge');

const DEFAULT_CHARGES = {
    fixedPrice: 40,
    fixedDistance: 5,
    pricePerKM: 10,
    rapidCharge: 25,
    fastDeliveryExtra: 25,
    isRapidAvailable: true,
    packagingCharge: 15,
    freeDeliveryThreshold: 500,
    taxPercentage: 5,
    taxInRupees: 0
};

// 1. SAVE/UPDATE DELIVERY CHARGES (Allows Multiple Location Entries)
const saveDeliveryCharges = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'superadmin' || req.user.role === 'subadmin';
        const vendorType = req.body.vendorType || req.query.vendorType || (isAdmin ? 'Food' : req.user.role);

        const country = req.body.country ? req.body.country.trim() : 'India';
        const state = req.body.state ? req.body.state.trim() : null;
        const city = req.body.city ? req.body.city.trim() : null;

        let filter = {};
        let updateData = { 
            ...req.body, 
            vendorType,
            country,
            state,
            city
        };

        // Normalize rapid charges
        if (req.body.rapidCharge !== undefined) {
            updateData.rapidCharge = Number(req.body.rapidCharge);
            updateData.fastDeliveryExtra = Number(req.body.rapidCharge);
        } else if (req.body.fastDeliveryExtra !== undefined) {
            updateData.rapidCharge = Number(req.body.fastDeliveryExtra);
            updateData.fastDeliveryExtra = Number(req.body.fastDeliveryExtra);
        }

        if (isAdmin) {
            if (req.body.vendorId) {
                // Specific Vendor Rate
                filter = { vendorId: req.body.vendorId };
                updateData.vendorId = req.body.vendorId;
                updateData.isAdminGlobal = false;
            } else if (city) {
                // 🚨 City-Specific Document (E.g. Mohali)
                filter = { 
                    vendorType, 
                    city: city,
                    isAdminGlobal: true 
                };
                updateData.isAdminGlobal = true;
                updateData.vendorId = null;
            } else if (state) {
                // 🚨 State-Specific Document (E.g. Punjab)
                filter = { 
                    vendorType, 
                    state: state,
                    city: null,
                    isAdminGlobal: true 
                };
                updateData.isAdminGlobal = true;
                updateData.vendorId = null;
            } else {
                // 🚨 Platform Global Document (All Cities fallback)
                filter = { 
                    vendorType, 
                    city: null,
                    state: null,
                    isAdminGlobal: true 
                };
                updateData.isAdminGlobal = true;
                updateData.vendorId = null;
            }
        } else {
            // Vendor's own charges
            filter = { vendorId: req.user.id };
            updateData.vendorId = req.user.id;
            updateData.isAdminGlobal = false;
        }

        const charges = await DeliveryCharge.findOneAndUpdate(
            filter,
            { $set: updateData },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: city 
                ? `Delivery charges for ${city} saved successfully!` 
                : "Delivery charges saved successfully!",
            data: charges
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET DELIVERY CHARGES (Returns All Records / List)
const getMyDeliveryCharges = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'superadmin' || req.user.role === 'subadmin' || req.user.role === 'admin';
        const { city, state, country, vendorId, vendorType } = req.query;

        let charges;

        if (isAdmin) {
            let filter = {};

            // Agar URL me query params bheje gaye hain toh filter karo, warna sara data aayega
            if (vendorType) filter.vendorType = vendorType;
            if (vendorId) filter.vendorId = vendorId;
            if (city) filter.city = new RegExp(`^${city.trim()}$`, 'i');
            if (state) filter.state = new RegExp(`^${state.trim()}$`, 'i');
            if (country) filter.country = new RegExp(`^${country.trim()}$`, 'i');

            // 🚨 Sare documents ek sath fetch honge (Array format)
            charges = await DeliveryCharge.find(filter).sort({ createdAt: -1 });

        } else {
            // Normal Vendor ke liye uske specific charges
            charges = await DeliveryCharge.find({ vendorId: req.user.id }).sort({ createdAt: -1 });
        }

        // Agar database khali hai
        if (!charges || charges.length === 0) {
            return res.json({
                success: true,
                count: 0,
                data: [],
                message: "No delivery charges found"
            });
        }

        // Saare records return honge
        res.json({
            success: true,
            count: charges.length,
            data: charges
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. UPDATE DELIVERY CHARGES
const updateDeliveryCharges = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'superadmin' || req.user.role === 'subadmin';
        const { id } = req.params;
        const vendorType = req.body.vendorType || req.query.vendorType || (isAdmin ? 'Food' : req.user.role);

        const country = req.body.country ? req.body.country.trim() : 'India';
        const state = req.body.state ? req.body.state.trim() : null;
        const city = req.body.city ? req.body.city.trim() : null;

        let filter = {};

        if (id) {
            filter = { _id: id };
        } else if (isAdmin) {
            if (req.body.vendorId) {
                filter = { vendorId: req.body.vendorId };
            } else if (city) {
                filter = { vendorType, city: city, isAdminGlobal: true };
            } else if (state) {
                filter = { vendorType, state: state, city: null, isAdminGlobal: true };
            } else {
                filter = { vendorType, city: null, state: null, isAdminGlobal: true };
            }
        } else {
            filter = { vendorId: req.user.id };
        }

        const updateData = { ...req.body };

        if (req.body.rapidCharge !== undefined) {
            updateData.rapidCharge = Number(req.body.rapidCharge);
            updateData.fastDeliveryExtra = Number(req.body.rapidCharge);
        } else if (req.body.fastDeliveryExtra !== undefined) {
            updateData.rapidCharge = Number(req.body.fastDeliveryExtra);
            updateData.fastDeliveryExtra = Number(req.body.fastDeliveryExtra);
        }

        const charges = await DeliveryCharge.findOneAndUpdate(
            filter,
            { $set: updateData },
            { new: true, upsert: true, runValidators: true }
        );

        res.json({
            success: true,
            message: "Delivery & Logistics rates updated successfully!",
            data: charges
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. CALCULATION ENGINE
const getCalculatedDelivery = (distance, orderTotal, charges, isRapidSelected = false) => {
    let baseShippingFee = 0;
    
    if (orderTotal >= (charges.freeDeliveryThreshold || 500)) {
        baseShippingFee = 0;
    } else {
        if (distance <= (charges.fixedDistance || 5)) {
            baseShippingFee = charges.fixedPrice || 40;
        } else {
            const extraDistance = distance - (charges.fixedDistance || 5);
            baseShippingFee = (charges.fixedPrice || 40) + (extraDistance * (charges.pricePerKM || 10));
        }
    }

    const packagingFee = charges.packagingCharge || 0;
    const rapidFee = isRapidSelected ? (charges.rapidCharge || charges.fastDeliveryExtra || 0) : 0;
    const subtotalLogistics = baseShippingFee + packagingFee + rapidFee;

    const taxPercentage = charges.taxPercentage || 0;
    const logisticsTax = Math.round(subtotalLogistics * (taxPercentage / 100));
    const totalDeliveryCost = subtotalLogistics + logisticsTax;

    return {
        baseShippingFee,
        packagingFee,
        rapidDeliveryCharge: rapidFee,
        logisticsTax,
        totalDeliveryCost
    };
};

module.exports = { 
    saveDeliveryCharges, 
    getMyDeliveryCharges, 
    updateDeliveryCharges, 
    getCalculatedDelivery 
};