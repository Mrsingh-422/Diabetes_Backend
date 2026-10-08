// controllers/user/CGMDevices/UserDiabetesCoach.js
const { generateCoachSlots } = require('../../../utils/timeSlotHelper');
const CGMOrder = require('../../../models/CGMOrder');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const { calculateHaversine } = require('../../../utils/helpers');
const mongoose = require('mongoose');

// =========================================================================
// 📍 1. POST API: GET COACHES WITH LIVE DISTANCE CALCULATION
// Endpoint: POST /user/cgm/coaches/nearby
// =========================================================================
const getNearbyDiabetesCoaches = async (req, res) => {
    try {
        const { 
            userLat, 
            userLng, 
            search = "", 
            city 
        } = req.body;

        const query = { isActive: true };

        if (city && city.trim() !== '') {
            query['location.city'] = { $regex: city.trim(), $options: 'i' };
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { 'location.city': regex },
                { languages: regex }
            ];
        }

        const coaches = await DiabetesCoach.find(query)
            .select('_id name profileImage price about languages location rating totalReviews createdAt')
            .lean();

        // 🧮 Calculate Distance for each coach using utils/helpers.js
        const uLat = Number(userLat);
        const uLng = Number(userLng);

        let formattedCoaches = coaches.map(coach => {
            let distanceInKM = null;

            if (uLat && uLng && coach.location?.lat && coach.location?.lng) {
                distanceInKM = calculateHaversine(
                    uLat, uLng,
                    Number(coach.location.lat), Number(coach.location.lng)
                );
            }

            return {
                _id: coach._id,
                name: coach.name,
                profileImage: coach.profileImage,
                price: coach.price, // Coach direct consultation price
                about: coach.about,
                languages: coach.languages || [],
                location: {
                    city: coach.location?.city || "N/A",
                    state: coach.location?.state || "N/A",
                    address: coach.location?.address || ""
                },
                distanceInKM: distanceInKM !== null ? distanceInKM : 0,
                distanceDisplay: distanceInKM !== null ? `${distanceInKM} km away` : "Distance N/A",
                rating: coach.rating || 4.9,
                totalReviews: coach.totalReviews || 0
            };
        });

        // 🚀 Nearest Coach first sort (Agar user coordinates mile hain)
        if (uLat && uLng) {
            formattedCoaches.sort((a, b) => a.distanceInKM - b.distanceInKM);
        }

        res.json({
            success: true,
            count: formattedCoaches.length,
            data: formattedCoaches
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 2. GET SINGLE COACH DETAILS BY ID (WITH OPTIONAL DATE SLOTS PREVIEW)
// Endpoint: GET /user/cgm/coaches/get/:id?selectedDate=2026-10-10
// =========================================================================
const getUserDiabetesCoachById = async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedDate } = req.query; // Optional e.g. "2026-10-10"

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        // Sensitive credentials (-password -token -fcmToken) exclude karein
        const coach = await DiabetesCoach.findOne({ _id: id, isActive: true })
            .select('-password -token -fcmToken')
            .lean();

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach profile not found or currently inactive." });
        }

        let generatedSlots = null;

        // Agar frontend ne selectedDate bheji hai, toh us date ke live slots generate karein
        if (selectedDate) {
            const bookedOrders = await CGMOrder.find({
                'coachConsultation.coachId': id,
                'coachConsultation.scheduledDate': selectedDate,
                status: { $in: ['Placed', 'Confirmed'] }
            }).select('coachConsultation.slotTime').lean();

            const bookedAppointments = bookedOrders.map(b => ({
                slotTime: b.coachConsultation?.slotTime
            }));

            generatedSlots = generateCoachSlots({
                config: coach.slotConfig || {},
                bookedAppointments,
                selectedDate,
                coachBasePrice: coach.price
            });
        }

        res.json({
            success: true,
            data: {
                ...coach,
                availableSlotsPreview: generatedSlots // Returns slots with premium extra fees & availability
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// ⏰ 3. GET COACH SLOTS FOR A SPECIFIC DATE (CALENDAR DATE PICKER)
// Endpoint: GET /user/cgm/coaches/slots/:id?selectedDate=2026-10-10
// =========================================================================
const getCoachAvailableSlots = async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        if (!selectedDate) {
            return res.status(400).json({ 
                success: false, 
                message: "selectedDate query parameter is required (format: YYYY-MM-DD)." 
            });
        }

        const coach = await DiabetesCoach.findById(id)
            .select('name price slotConfig isActive')
            .lean();

        if (!coach || coach.isActive === false) {
            return res.status(404).json({ success: false, message: "Coach not found or currently inactive." });
        }

        // 🚫 CHECK: Agar DB mein coach ne slots set hi nahi kiye hain, toh Dummy slots mat bhejo
        if (!coach.slotConfig || !coach.slotConfig.startTime || !coach.slotConfig.endTime) {
            return res.json({
                success: true,
                coach: {
                    _id: coach._id,
                    name: coach.name,
                    basePrice: Number(coach.price) || 0
                },
                selectedDate,
                message: "No consultation slots have been configured by this coach yet.",
                data: {
                    isClosed: true,
                    reason: "Coach has not set up working hours yet.",
                    slots: [] // 👈 Empty array (No dummy slots)
                }
            });
        }

        // Already booked appointments check
        let bookedAppointments = [];
        try {
            const bookedOrders = await CGMOrder.find({
                'coachConsultation.coachId': id,
                'coachConsultation.scheduledDate': selectedDate,
                status: { $in: ['Placed', 'Confirmed'] }
            }).select('coachConsultation.slotTime').lean();

            bookedAppointments = (bookedOrders || []).map(b => ({
                slotTime: b.coachConsultation?.slotTime
            }));
        } catch (dbErr) {
            bookedAppointments = [];
        }

        // Coach ki actual DB configuration se slots generate karein
        const slotsData = generateCoachSlots({
            config: coach.slotConfig,
            bookedAppointments,
            selectedDate,
            coachBasePrice: Number(coach.price) || 0
        });

        res.json({
            success: true,
            coach: {
                _id: coach._id,
                name: coach.name,
                basePrice: Number(coach.price) || 0
            },
            selectedDate,
            data: slotsData
        });

    } catch (error) {
        console.error("Error in getCoachAvailableSlots:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getNearbyDiabetesCoaches,
    getUserDiabetesCoachById,
    getCoachAvailableSlots
};