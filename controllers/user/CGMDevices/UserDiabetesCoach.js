// controllers/user/CGMDevices/UserDiabetesCoach.js
const { generateCoachSlots } = require('../../../utils/timeSlotHelper');
const DiabeticCoachBooking = require('../../../models/DiabeticCoachBooking');
const CGMOrder = require('../../../models/CGMOrder');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const { calculateHaversine } = require('../../../utils/helpers');
const mongoose = require('mongoose');

// =========================================================================
// 📍 1. POST API: GET COACHES WITH DISTANCE, MODES & TRAVEL COST
// Endpoint: POST /user/cgm/coaches/nearby
// =========================================================================
const getNearbyDiabetesCoaches = async (req, res) => {
    try {
        const { 
            userLat, 
            userLng, 
            search = "", 
            city, 
            coachType // 'Diabetes Educator', 'Diabetes Coach', 'Both'
        } = req.body;

        const query = { isActive: true };

        if (coachType && coachType.trim() !== '') {
            query.coachType = { $in: [coachType.trim(), 'Both'] };
        }

        if (city && city.trim() !== '') {
            query['location.city'] = { $regex: city.trim(), $options: 'i' };
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { qualification: regex },
                { 'location.city': regex },
                { languages: regex }
            ];
        }

        const coaches = await DiabetesCoach.find(query)
            .select('-password -token -fcmToken')
            .lean();

        const uLat = Number(userLat);
        const uLng = Number(userLng);

        let formattedCoaches = coaches.map(coach => {
            let distanceInKM = 0;

            if (uLat && uLng && coach.location?.lat && coach.location?.lng) {
                distanceInKM = calculateHaversine(
                    uLat, uLng,
                    Number(coach.location.lat), Number(coach.location.lng)
                );
            }

            // Offline Distance Travel Fee Calculation
            const baseKM = Number(coach.offlinePricing?.baseDistanceKM) || 5;
            const extraRate = Number(coach.offlinePricing?.extraPricePerKM) || 15;
            const extraKM = distanceInKM > baseKM ? Number((distanceInKM - baseKM).toFixed(1)) : 0;
            const extraDistanceFee = Math.round(extraKM * extraRate);

            const onlineFee = coach.fees?.online !== undefined ? Number(coach.fees.online) : (Number(coach.price) || 299);
            const offlineBaseFee = coach.fees?.offline !== undefined ? Number(coach.fees.offline) : 599;
            const totalEstimatedOfflineFee = offlineBaseFee + extraDistanceFee;

            return {
                _id: coach._id,
                name: coach.name,
                qualification: coach.qualification || "Certified Diabetes Educator",
                coachType: coach.coachType || "Both",
                profileImage: coach.profileImage,
                about: coach.about,
                languages: coach.languages || [],
                pricing: {
                    onlineFee,
                    offlineBaseFee,
                    extraDistanceFee,
                    totalEstimatedOfflineFee
                },
                consultationModes: coach.consultationModes || { isOnlineAvailable: true, isOfflineAvailable: true },
                offlinePricingRules: {
                    baseDistanceKM: baseKM,
                    extraPricePerKM: extraRate,
                    maxServiceRadiusKM: Number(coach.offlinePricing?.maxServiceRadiusKM) || 25
                },
                location: {
                    city: coach.location?.city || "N/A",
                    state: coach.location?.state || "N/A",
                    address: coach.location?.address || ""
                },
                distanceInKM: distanceInKM,
                distanceDisplay: distanceInKM > 0 ? `${distanceInKM} km away` : "Location not provided",
                rating: coach.rating || 4.9,
                totalReviews: coach.totalReviews || 0
            };
        });

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
// 🔍 2. GET SINGLE COACH DETAILS BY ID (WITH REAL-TIME BOOKED SLOTS)
// Endpoint: GET /user/cgm/coaches/get/:id?selectedDate=2026-10-10
// =========================================================================
const getUserDiabetesCoachById = async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        const coach = await DiabetesCoach.findOne({ _id: id, isActive: true })
            .select('-password -token -fcmToken')
            .lean();

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach profile not found or currently inactive." });
        }

        let generatedSlots = null;

        if (selectedDate) {
            if (!coach.slotConfig || !coach.slotConfig.startTime || !coach.slotConfig.endTime) {
                generatedSlots = {
                    isClosed: true,
                    reason: "No slots configured by coach yet.",
                    slots: []
                };
            } else {
                let bookedAppointments = [];
                try {
                    // 15-Minute Payment Timeout (Agar 15 min me pay nahi kiya toh slot auto-free)
                    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

                    // A. Fetch from Dedicated DiabeticCoachBooking Model
                    const coachBookings = await DiabeticCoachBooking.find({
                        coachId: id,
                        scheduledDate: selectedDate,
                        $or: [
                            { status: { $in: ['Confirmed', 'In-Progress'] } },
                            { status: 'Placed', createdAt: { $gte: fifteenMinsAgo } } // Unpaid hold only for 15 mins
                        ]
                    }).select('slotTime').lean();

                    // B. Fetch from CGMOrder (Device checkout bundle bookings)
                    const cgmOrders = await CGMOrder.find({
                        'coachConsultation.coachId': id,
                        'coachConsultation.scheduledDate': selectedDate,
                        $or: [
                            { status: { $in: ['Confirmed', 'In-Progress'] } },
                            { status: 'Placed', createdAt: { $gte: fifteenMinsAgo } }
                        ]
                    }).select('coachConsultation.slotTime').lean();

                    bookedAppointments = [
                        ...(coachBookings || []).map(b => ({ slotTime: b.slotTime })),
                        ...(cgmOrders || []).map(b => ({ slotTime: b.coachConsultation?.slotTime }))
                    ];
                } catch (dbErr) {
                    bookedAppointments = [];
                }

                generatedSlots = generateCoachSlots({
                    config: coach.slotConfig,
                    bookedAppointments,
                    selectedDate,
                    coachBasePrice: Number(coach.fees?.online) || Number(coach.price) || 0
                });
            }
        }

        res.json({
            success: true,
            data: {
                ...coach,
                availableSlotsPreview: generatedSlots
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
                    slots: []
                }
            });
        }

        // Real-Time Active Bookings Check
        let bookedAppointments = [];
        try {
            // Unpaid orders ko sirf 15 min tak block rakhenge, uske baad auto-free ho jayega
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

            // 1. Fetch from DiabeticCoachBooking
            const coachBookings = await DiabeticCoachBooking.find({
                coachId: id,
                scheduledDate: selectedDate,
                $or: [
                    { status: { $in: ['Confirmed', 'In-Progress'] } },
                    { status: 'Placed', createdAt: { $gte: fifteenMinsAgo } }
                ]
            }).select('slotTime').lean();

            // 2. Fetch from CGMOrder
            const cgmOrders = await CGMOrder.find({
                'coachConsultation.coachId': id,
                'coachConsultation.scheduledDate': selectedDate,
                $or: [
                    { status: { $in: ['Confirmed', 'In-Progress'] } },
                    { status: 'Placed', createdAt: { $gte: fifteenMinsAgo } }
                ]
            }).select('coachConsultation.slotTime').lean();

            bookedAppointments = [
                ...(coachBookings || []).map(b => ({ slotTime: b.slotTime })),
                ...(cgmOrders || []).map(b => ({ slotTime: b.coachConsultation?.slotTime }))
            ];
        } catch (dbErr) {
            bookedAppointments = [];
        }

        // Slot Generator ko actual booked slots bhejo
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