// controllers/admin/CGM/CoachDistanceConfig.js

const CoachDistanceConfig = require('../../../models/CoachDistanceConfig');

// 1. Get Current Distance Config
const getDistanceConfig = async (req, res) => {
    try {
        let config = await CoachDistanceConfig.findOne().sort({ createdAt: -1 });

        // Agar DB me config nahi hai toh default fallback return karein
        if (!config) {
            config = {
                freeDistanceKM: 5,
                pricePerKM: 15,
                maxServiceRadiusKM: 30,
                isActive: true
            };
        }

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Set / Update Distance Config (Admin Handles this)
const setDistanceConfig = async (req, res) => {
    try {
        const { freeDistanceKM, pricePerKM, maxServiceRadiusKM, isActive } = req.body;

        if (freeDistanceKM === undefined || pricePerKM === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: "freeDistanceKM and pricePerKM are required." 
            });
        }

        let config = await CoachDistanceConfig.findOne();

        if (config) {
            config.freeDistanceKM = Number(freeDistanceKM);
            config.pricePerKM = Number(pricePerKM);
            if (maxServiceRadiusKM !== undefined) config.maxServiceRadiusKM = Number(maxServiceRadiusKM);
            if (isActive !== undefined) config.isActive = Boolean(isActive);
            config.updatedBy = req.user?.id || null;
            await config.save();
        } else {
            config = await CoachDistanceConfig.create({
                freeDistanceKM: Number(freeDistanceKM),
                pricePerKM: Number(pricePerKM),
                maxServiceRadiusKM: maxServiceRadiusKM !== undefined ? Number(maxServiceRadiusKM) : 30,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
                updatedBy: req.user?.id || null
            });
        }

        res.json({
            success: true,
            message: "Coach offline distance pricing configuration saved successfully!",
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getDistanceConfig,
    setDistanceConfig
};