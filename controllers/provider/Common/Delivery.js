const DeliveryCharge = require('../../../models/DeliveryCharge');

// Default Values synced with your live Figma layout
const DEFAULT_CHARGES = {
    fixedPrice: 40,
    fixedDistance: 5,
    pricePerKM: 10,
    fastDeliveryExtra: 25,
    packagingCharge: 15,
    freeDeliveryThreshold: 500,
    taxPercentage: 5,
    taxInRupees: 0
};

// 1. SAVE/UPDATE DELIVERY CHARGES
const saveDeliveryCharges = async (req, res) => {
    try {
        let vendorId = req.user.id;
        let vendorType = req.user.role; // Role: Lab, Pharmacy, Food

        // 🚨 CRITICAL FIX: If Admin is updating, read target vendor parameters from req.body
        if (req.user.role === 'superadmin' || req.user.role === 'subadmin') {
            vendorId = req.body.vendorId;
            vendorType = req.body.vendorType;

            if (!vendorId || !vendorType) {
                return res.status(400).json({ success: false, message: "vendorId and vendorType are required for admin updates." });
            }
        }

        const charges = await DeliveryCharge.findOneAndUpdate(
            { vendorId: vendorId },
            { 
                $set: { 
                    ...req.body, 
                    vendorId, 
                    vendorType 
                } 
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Delivery charges saved successfully!", data: charges });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET MY DELIVERY CHARGES
const getMyDeliveryCharges = async (req, res) => {
    try {
        let targetId = req.user.id;

        // If admin is requesting specific vendor charges via query
        if ((req.user.role === 'superadmin' || req.user.role === 'subadmin') && req.query.vendorId) {
            targetId = req.query.vendorId;
        }

        const charges = await DeliveryCharge.findOne({ vendorId: targetId });

        if (!charges) {
            // Fallback for Admin vs Vendor role
            const activeRole = req.query.vendorType || req.user.role;
            return res.json({ 
                success: true, 
                data: { ...DEFAULT_CHARGES, vendorType: activeRole }, 
                isDefault: true 
            });
        }
        
        res.json({ success: true, data: charges, isDefault: false });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. COMPLETE USER SIDE CHECKOUT CALCULATION ENGINE (Figma Matches)
const getCalculatedDelivery = (distance, orderTotal, charges, isFastDeliverySelected = false) => {
    let baseShippingFee = 0;
    
    // A. Check Free Delivery Threshold bypass
    if (orderTotal >= charges.freeDeliveryThreshold) {
        baseShippingFee = 0;
    } else {
        // B. Distance Proximity calculation
        if (distance <= charges.fixedDistance) {
            baseShippingFee = charges.fixedPrice;
        } else {
            const extraDistance = distance - charges.fixedDistance;
            baseShippingFee = charges.fixedPrice + (extraDistance * charges.pricePerKM);
        }
    }

    // C. Packaging fees & Surcharges appends
    const packagingFee = charges.packagingCharge || 0;
    const fastDeliveryFee = isFastDeliverySelected ? (charges.fastDeliveryExtra || 0) : 0;
    
    const subtotalLogistics = baseShippingFee + packagingFee + fastDeliveryFee;

    // D. Taxation assessment (applied on delivery subtotal)
    const taxPercentage = charges.taxPercentage || 0;
    const logisticsTax = Math.round(subtotalLogistics * (taxPercentage / 100));

    // E. Total dynamic delivery cost
    const totalDeliveryCost = subtotalLogistics + logisticsTax;

    return {
        baseShippingFee,
        packagingFee,
        fastDeliveryFee,
        logisticsTax,
        totalDeliveryCost // Final payable delivery charge [cite: custom_context]
    };
};

module.exports = { saveDeliveryCharges, getMyDeliveryCharges, getCalculatedDelivery };