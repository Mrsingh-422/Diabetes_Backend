// controllers/clinic/clinicAmbulanceSlots.js
const Ambulance = require('../../models/Ambulance');
const Availability = require('../../models/Availability');
const AmbulanceBooking = require('../../models/AmbulanceBooking');
const { generateAmbulanceSlots } = require('../../utils/timeSlotHelper');
const mongoose = require('mongoose');

// ==========================================
// 1. GET ONLY TIME SLOTS (Bulletproof Version)
// Endpoint: GET /api/clinic/ambulance-slots
// ==========================================
const getClinicAmbulanceSlots = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { ambulanceId, date } = req.query;

        let ambulance = null;

        // 1. Agar specific ambulanceId bheji hai
        if (ambulanceId && mongoose.Types.ObjectId.isValid(ambulanceId)) {
            ambulance = await Ambulance.findById(ambulanceId);
        }

        // 2. Agar ambulanceId nahi bheji ya upar nahi mili, toh logged-in clinic ki pehli ambulance utha lo
        if (!ambulance) {
            ambulance = await Ambulance.findOne({ clinicId });
        }

        if (!ambulance) {
            return res.status(200).json({
                success: false,
                message: `No ambulance found for Clinic ID: ${clinicId}. Please register an ambulance first.`,
                totalSlots: 0,
                slots: []
            });
        }

        const config = await Availability.findOne({ vendorId: ambulance._id });
        const selectedDate = date || new Date().toISOString().split('T')[0];

        if (!config) {
            return res.status(200).json({
                success: true,
                message: `Slots are not configured yet for Ambulance '${ambulance.vehicleNumber || ambulance.name}'. Please call PUT /update first.`,
                ambulanceId: ambulance._id,
                vehicleNumber: ambulance.vehicleNumber,
                totalSlots: 0,
                slots: []
            });
        }

        // Fetch Booked Trips
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        const activeBookings = await AmbulanceBooking.find({
            ambulanceId: ambulance._id,
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] },
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        }).select('createdAt scheduledAt status').lean();

        const slotResult = generateAmbulanceSlots(config, activeBookings, selectedDate);

        res.status(200).json({
            success: true,
            ambulanceId: ambulance._id,
            vehicleNumber: ambulance.vehicleNumber,
            selectedDate,
            totalSlots: (slotResult.slots || []).length,
            slots: slotResult.slots || []
        });

    } catch (error) {
        res.status(200).json({ success: false, message: error.message, totalSlots: 0, slots: [] });
    }
};

// ==========================================
// 2. SET / UPDATE SLOTS (Auto-Finds & Self-Diagnosing)
// Endpoint: PUT /api/clinic/ambulance-slots/update
// ==========================================
const updateClinicAmbulanceSlots = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            ambulanceId,
            startTime = "08:00",
            endTime = "20:00",
            slotDuration = 120,
            availableForEmergency = true,
            offDays = ["Sunday"],
            blockedDates = [],
            premiumSlots = []
        } = req.body;

        let ambulance = null;

        // 1. Check by provided ambulanceId
        if (ambulanceId && mongoose.Types.ObjectId.isValid(ambulanceId)) {
            ambulance = await Ambulance.findById(ambulanceId);
        }

        // 2. Fallback: Auto-find clinic's ambulance if not provided or to check association
        if (!ambulance) {
            ambulance = await Ambulance.findOne({ clinicId });
        }

        if (!ambulance) {
            return res.status(200).json({
                success: false,
                message: `No ambulance found for logged-in Clinic (ID: ${clinicId}). Please add an ambulance first.`
            });
        }

        // 3. Agar ambulance kisi doosre clinic ki hai, toh clinicId ko link/sync karein
        if (!ambulance.clinicId || ambulance.clinicId.toString() !== clinicId.toString()) {
            ambulance.clinicId = clinicId;
            ambulance.role = 'clinic-ambulance';
        }

        ambulance.availableForEmergency = Boolean(availableForEmergency);
        await ambulance.save();

        // 4. Save to Availability
        const availabilityPayload = {
            vendorId: ambulance._id,
            vendorType: 'clinic-ambulance',
            clinicId: clinicId,
            startTime,
            endTime,
            slotDuration: Number(slotDuration),
            offDays: offDays || ["Sunday"],
            blockedDates: blockedDates || [],
            premiumSlots: premiumSlots || []
        };

        const updatedConfig = await Availability.findOneAndUpdate(
            { vendorId: ambulance._id },
            { $set: availabilityPayload },
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: `Slots configured successfully for Ambulance '${ambulance.vehicleNumber || ambulance.name}'.`,
            ambulanceId: ambulance._id,
            vehicleNumber: ambulance.vehicleNumber,
            clinicId: ambulance.clinicId,
            config: updatedConfig
        });

    } catch (error) {
        res.status(200).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. BLOCK TIME SLOT
// Endpoint: POST /api/clinic/ambulance-slots/block-slot
// ==========================================
const blockClinicAmbulanceSlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { ambulanceId, time } = req.body;

        if (!time) {
            return res.status(200).json({ success: false, message: "Time slot is required (e.g. '10:00')" });
        }

        let ambulance = null;
        if (ambulanceId && mongoose.Types.ObjectId.isValid(ambulanceId)) {
            ambulance = await Ambulance.findById(ambulanceId);
        }
        if (!ambulance) {
            ambulance = await Ambulance.findOne({ clinicId });
        }

        if (!ambulance) {
            return res.status(200).json({ success: false, message: "Ambulance not found." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: ambulance._id },
            { 
                $set: { vendorType: 'clinic-ambulance', clinicId },
                $addToSet: { unavailableSlots: time } 
            },
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: `Time slot '${time}' hidden successfully for Ambulance '${ambulance.vehicleNumber || ambulance.name}'.`
        });

    } catch (error) {
        res.status(200).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UNBLOCK TIME SLOT
// Endpoint: POST /api/clinic/ambulance-slots/unblock-slot
// ==========================================
const unblockClinicAmbulanceSlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { ambulanceId, time } = req.body;

        if (!time) {
            return res.status(200).json({ success: false, message: "Time slot is required (e.g. '10:00')" });
        }

        let ambulance = null;
        if (ambulanceId && mongoose.Types.ObjectId.isValid(ambulanceId)) {
            ambulance = await Ambulance.findById(ambulanceId);
        }
        if (!ambulance) {
            ambulance = await Ambulance.findOne({ clinicId });
        }

        if (!ambulance) {
            return res.status(200).json({ success: false, message: "Ambulance not found." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: ambulance._id },
            { $pull: { unavailableSlots: time } }
        );

        res.status(200).json({
            success: true,
            message: `Time slot '${time}' is now visible and bookable again for Ambulance '${ambulance.vehicleNumber || ambulance.name}'.`
        });

    } catch (error) {
        res.status(200).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinicAmbulanceSlots,
    updateClinicAmbulanceSlots,
    blockClinicAmbulanceSlot,
    unblockClinicAmbulanceSlot
};