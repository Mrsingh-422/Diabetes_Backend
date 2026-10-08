// controllers/coach/coachSlotController.js

const DiabetesCoach = require('../../models/DiabetesCoach');
const { generateCoachSlots } = require('../../utils/timeSlotHelper');

// =========================================================================
// ⏰ 1. COACH SELF SET / UPDATE SLOTS & PREMIUM SLOTS
// Endpoint: PUT /api/coach/slots/my-slots
// =========================================================================
const setMySlotConfig = async (req, res) => {
    try {
        const coachId = req.user.id; // Logged-in Coach ID from JWT token
        const {
            startTime,
            endTime,
            slotDuration,
            morningSlots,
            afternoonSlots,
            eveningSlots,
            premiumSlots,
            unavailableSlots,
            offDays,
            blockedDates
        } = req.body;

        const coach = await DiabetesCoach.findById(coachId);
        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach account not found." });
        }

        // Coach updates their own slots
        coach.slotConfig = {
            startTime: startTime || coach.slotConfig?.startTime || "09:00",
            endTime: endTime || coach.slotConfig?.endTime || "20:00",
            slotDuration: slotDuration !== undefined ? Number(slotDuration) : (coach.slotConfig?.slotDuration || 30),
            morningSlots: morningSlots !== undefined ? Boolean(morningSlots) : (coach.slotConfig?.morningSlots ?? true),
            afternoonSlots: afternoonSlots !== undefined ? Boolean(afternoonSlots) : (coach.slotConfig?.afternoonSlots ?? true),
            eveningSlots: eveningSlots !== undefined ? Boolean(eveningSlots) : (coach.slotConfig?.eveningSlots ?? true),
            premiumSlots: Array.isArray(premiumSlots) ? premiumSlots : (coach.slotConfig?.premiumSlots || []),
            unavailableSlots: Array.isArray(unavailableSlots) ? unavailableSlots : (coach.slotConfig?.unavailableSlots || []),
            offDays: Array.isArray(offDays) ? offDays : (coach.slotConfig?.offDays || []),
            blockedDates: Array.isArray(blockedDates) ? blockedDates : (coach.slotConfig?.blockedDates || [])
        };

        await coach.save();

        res.json({
            success: true,
            message: "Your consultation slots and premium fees have been updated successfully!",
            data: coach.slotConfig
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 2. COACH GET OWN SLOTS CONFIG & DATE-WISE PREVIEW
// Endpoint: GET /api/coach/slots/my-slots
// =========================================================================
const getMySlotConfig = async (req, res) => {
    try {
        const coachId = req.user.id; // Logged-in Coach ID from JWT token
        const { selectedDate } = req.query; // Optional e.g. "2026-10-10"

        const coach = await DiabetesCoach.findById(coachId).lean();
        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach account not found." });
        }

        const config = coach.slotConfig || {
            startTime: "09:00",
            endTime: "20:00",
            slotDuration: 30,
            morningSlots: true,
            afternoonSlots: true,
            eveningSlots: true,
            premiumSlots: [],
            unavailableSlots: [],
            offDays: [],
            blockedDates: []
        };

        let generatedSlotsPreview = null;

        // If date passed, calculate slots with premium extra fees & collision check
        if (selectedDate) {
            const CGMOrder = require('../../models/CGMOrder');
            const bookedAppointments = await CGMOrder.find({
                'coachConsultation.coachId': coachId,
                status: { $in: ['Placed', 'Confirmed'] }
            }).select('appointmentTime slotTime scheduledTime createdAt').lean();

            generatedSlotsPreview = generateCoachSlots({
                config,
                bookedAppointments,
                selectedDate,
                coachBasePrice: coach.price
            });
        }

        res.json({
            success: true,
            coach: {
                _id: coach._id,
                name: coach.name,
                basePrice: coach.price
            },
            slotConfig: config,
            generatedSlotsPreview
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    setMySlotConfig,
    getMySlotConfig
};