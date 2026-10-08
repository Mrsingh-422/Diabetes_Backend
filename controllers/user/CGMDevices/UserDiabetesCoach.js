// controllers/user/CGMDevices/UserDiabetesCoachController.js

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
// 🔍 2. GET API: SINGLE COACH FULL DETAILS BY ID
// Endpoint: GET /user/cgm/coaches/get/:id
// =========================================================================
const getUserDiabetesCoachById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        const coach = await DiabetesCoach.findOne({ _id: id, isActive: true }).lean();

        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach profile not found." });
        }

        res.json({
            success: true,
            data: coach
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getNearbyDiabetesCoaches,
    getUserDiabetesCoachById
};