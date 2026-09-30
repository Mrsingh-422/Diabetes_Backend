// controllers/user/Ambulance/userAmbulanceController.js
const Ambulance = require('../../../models/Ambulance');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { calculateHaversine } = require('../../../utils/helpers');
const Availability = require('../../../models/Availability');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const { generateAmbulanceSlots } = require('../../../utils/timeSlotHelper');
const mongoose = require('mongoose');

// Default Fallback Location (Mohali Center)
const DEFAULT_LAT = 30.7046;
const DEFAULT_LNG = 76.7179;

// ==========================================
// 🚑 1. GET NEARBY AMBULANCES (Includes Independent & Clinic Ambulances with Live Distance)
// Endpoint: POST /api/user/ambulance/nearest
// ==========================================
const getNearbyAmbulances = async (req, res) => {
    try {
        const {
            lat,
            lng,
            search,
            city,
            vehicleType,      // 'Van', 'Mini Van', 'Advance Life Support', 'ICU Ambulance'
            hasNurse,         // true | false
            hasDoctor,        // true | false
            type = 'all',     // 'all' (Default: Both) | 'clinic' | 'independent'
            clinicId,         // Optional: Specific clinic filter
            page = 1,
            limit = 10
        } = req.body || {};

        // Fallback default coordinates (Mohali Center) if location not provided
        const userLat = lat !== undefined && lat !== null && lat !== "" ? Number(lat) : DEFAULT_LAT;
        const userLng = lng !== undefined && lng !== null && lng !== "" ? Number(lng) : DEFAULT_LNG;
        const isDefaultLocation = (!lat || !lng);

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;

        // 1. Dynamic Admin KM Limit
        const limitConfig = await VendorKMLimit.findOne({
            vendorType: { $regex: /^ambulance$/i },
            $or: [{ isActive: true }, { isActive: { $exists: false } }]
        }).lean();

        const maxDistanceLimit = limitConfig?.kmLimit ? Number(limitConfig.kmLimit) : 100;

        // 2. Base Query: Approved, Active & Online Ambulances
        let query = {
            profileStatus: 'Approved',
            isActive: true,
            isOnline: true,
            availableForEmergency: true
        };

        // Filter: Clinic vs Independent vs All (Default: All)
        if (clinicId && mongoose.Types.ObjectId.isValid(clinicId)) {
            query.clinicId = clinicId;
        } else if (type === 'clinic') {
            query.$or = [
                { role: 'clinic-ambulance' },
                { clinicId: { $ne: null, $exists: true } }
            ];
        } else if (type === 'independent') {
            query.role = 'ambulance';
            query.$or = [
                { clinicId: null },
                { clinicId: { $exists: false } }
            ];
        }

        if (city && city.trim() !== '') {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        if (vehicleType && vehicleType.trim() !== '') {
            query.vehicleType = vehicleType.trim();
        }

        if (hasNurse === true || hasNurse === 'true') {
            query['supportStaff.nurse.available'] = true;
        }

        if (hasDoctor === true || hasDoctor === 'true') {
            query['supportStaff.doctor.available'] = true;
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { name: regex },
                { vehicleNumber: regex },
                { vehicleType: regex },
                { city: regex },
                { address: regex }
            ];
        }

        // 3. Fetch Ambulances (with Clinic info populated)
        const ambulances = await Ambulance.find(query)
            .select('name phone email vehicleNumber vehicleType bloodGroup experienceYears serviceRadius pricing supportStaff location city state address clinicId role averageRating totalReviews')
            .populate('clinicId', 'name clinicName city state address phoneNumber image location')
            .lean();

        if (ambulances.length === 0) {
            return res.json({
                success: true,
                message: "No active ambulances available in this area.",
                userLocation: {
                    lat: userLat,
                    lng: userLng,
                    isDefault: isDefaultLocation
                },
                totalDocs: 0,
                totalPages: 0,
                currentPage: pageNum,
                limit: limitNum,
                count: 0,
                data: []
            });
        }

        // 4. Calculate Distance & Format
        const allList = [];
        const withinRadiusList = [];

        for (let amb of ambulances) {
            let ambLat = amb.location?.lat ? Number(amb.location.lat) : 0;
            let ambLng = amb.location?.lng ? Number(amb.location.lng) : 0;

            // Agar ambulance location 0 hai toh clinic location fallback use karein
            if (ambLat === 0 && ambLng === 0 && amb.clinicId?.location) {
                if (Array.isArray(amb.clinicId.location.coordinates) && amb.clinicId.location.coordinates.length === 2) {
                    ambLng = Number(amb.clinicId.location.coordinates[0]);
                    ambLat = Number(amb.clinicId.location.coordinates[1]);
                } else if (amb.clinicId.location.lat && amb.clinicId.location.lng) {
                    ambLat = Number(amb.clinicId.location.lat);
                    ambLng = Number(amb.clinicId.location.lng);
                }
            }

            let distance = 0;
            if (ambLat !== 0 && ambLng !== 0) {
                distance = calculateHaversine(userLat, userLng, ambLat, ambLng);
            }

            const isClinicAttached = Boolean(amb.clinicId);

            const item = {
                _id: amb._id,
                driverName: amb.name,
                phone: amb.phone,
                email: amb.email || "",
                vehicleNumber: amb.vehicleNumber,
                vehicleType: amb.vehicleType,
                bloodGroup: amb.bloodGroup || "N/A",
                experienceYears: amb.experienceYears || "N/A",
                serviceRadius: amb.serviceRadius || "15 km",
                city: amb.city || amb.clinicId?.city || "Mohali",
                state: amb.state || amb.clinicId?.state || "",
                address: amb.address || amb.clinicId?.address || "",
                providerType: isClinicAttached ? "Clinic Ambulance" : "Independent Ambulance",
                isClinicAmbulance: isClinicAttached,

                // 📍 Live Coordinates & Distance
                userLocation: {
                    lat: userLat,
                    lng: userLng
                },
                ambulanceLocation: {
                    lat: ambLat,
                    lng: ambLng
                },
                distance: Number(distance.toFixed(1)),
                distanceText: distance > 0 ? `${distance.toFixed(1)} km away` : "Nearby",

                // 🏥 Clinic Details (if attached)
                clinic: isClinicAttached ? {
                    _id: amb.clinicId._id,
                    name: amb.clinicId.clinicName || amb.clinicId.name,
                    city: amb.clinicId.city,
                    address: amb.clinicId.address,
                    phone: amb.clinicId.phoneNumber,
                    image: amb.clinicId.image
                } : null,

                supportStaff: {
                    nurse: {
                        available: Boolean(amb.supportStaff?.nurse?.available),
                        price: amb.supportStaff?.nurse?.price || 0
                    },
                    doctor: {
                        available: Boolean(amb.supportStaff?.doctor?.available),
                        price: amb.supportStaff?.doctor?.price || 0
                    }
                },

                pricing: {
                    singleRidePrice: amb.pricing?.singleRidePrice || 400,
                    doubleRidePrice: amb.pricing?.doubleRidePrice || 700,
                    baseDistance: amb.pricing?.baseDistance || 5,
                    pricePerKM: amb.pricing?.pricePerKM || 12
                },

                rating: amb.averageRating || 4.8,
                totalReviews: amb.totalReviews || 0
            };

            allList.push(item);
            if (distance <= maxDistanceLimit) {
                withinRadiusList.push(item);
            }
        }

        // Sort nearest distance first
        const finalList = withinRadiusList.length > 0 ? withinRadiusList : allList;
        finalList.sort((a, b) => a.distance - b.distance);

        // Pagination
        const totalDocs = finalList.length;
        const skip = (pageNum - 1) * limitNum;
        const paginatedData = finalList.slice(skip, skip + limitNum);

        res.json({
            success: true,
            userLocation: {
                lat: userLat,
                lng: userLng,
                locationUsed: isDefaultLocation ? "Mohali (Default Fallback)" : "User Live GPS Location"
            },
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: paginatedData.length,
            data: paginatedData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 2. GET SINGLE AMBULANCE DETAILS BY ID
// Endpoint: GET /api/user/ambulance/details/:id
// ==========================================
const getAmbulanceDetailsForUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Ambulance ID." });
        }

        const ambulance = await Ambulance.findOne({
            _id: id,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('-password -token -fcmToken -rejectionReason -bankDetails')
        .populate('clinicId', 'name clinicName city state address phoneNumber image')
        .lean();

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found or currently unavailable." });
        }

        // Live Distance calculation
        let distance = 0;
        let distanceText = "Nearby";
        if (lat && lng && ambulance.location?.lat && ambulance.location?.lng) {
            distance = calculateHaversine(Number(lat), Number(lng), Number(ambulance.location.lat), Number(ambulance.location.lng));
            distanceText = `${distance.toFixed(1)} km away`;
        }

        res.json({
            success: true,
            data: {
                _id: ambulance._id,
                driverName: ambulance.name,
                phone: ambulance.phone,
                email: ambulance.email || "",
                vehicleNumber: ambulance.vehicleNumber,
                vehicleType: ambulance.vehicleType,
                bloodGroup: ambulance.bloodGroup || "N/A",
                experienceYears: ambulance.experienceYears || "N/A",
                serviceRadius: ambulance.serviceRadius || "15 km",
                address: ambulance.address || "",
                city: ambulance.city || "",
                state: ambulance.state || "",
                country: ambulance.country || "India",
                providerType: ambulance.clinicId ? "Clinic Ambulance" : "Independent Ambulance",

                clinic: ambulance.clinicId ? {
                    _id: ambulance.clinicId._id,
                    name: ambulance.clinicId.clinicName || ambulance.clinicId.name,
                    city: ambulance.clinicId.city,
                    address: ambulance.clinicId.address,
                    phone: ambulance.clinicId.phoneNumber,
                    image: ambulance.clinicId.image
                } : null,

                supportStaff: {
                    nurse: {
                        available: Boolean(ambulance.supportStaff?.nurse?.available),
                        price: ambulance.supportStaff?.nurse?.price || 0
                    },
                    doctor: {
                        available: Boolean(ambulance.supportStaff?.doctor?.available),
                        price: ambulance.supportStaff?.doctor?.price || 0
                    }
                },

                pricing: {
                    singleRidePrice: ambulance.pricing?.singleRidePrice || 400,
                    doubleRidePrice: ambulance.pricing?.doubleRidePrice || 700,
                    baseDistance: ambulance.pricing?.baseDistance || 5,
                    pricePerKM: ambulance.pricing?.pricePerKM || 12
                },

                rating: ambulance.averageRating || 4.8,
                totalReviews: ambulance.totalReviews || 0,
                location: ambulance.location || { lat: 0, lng: 0 },
                distance: Number(distance.toFixed(1)),
                distanceText
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🕒 GET CLINIC-AMBULANCE TIME SLOTS (User Side)
// Endpoint: GET /api/user/ambulance/slots/:ambulanceId?date=YYYY-MM-DD
// ==========================================
const getClinicAmbulanceSlotsForUser = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const { date } = req.query;

        if (!mongoose.Types.ObjectId.isValid(ambulanceId)) {
            return res.status(400).json({ success: false, message: `Invalid Ambulance ID format: '${ambulanceId}'` });
        }

        // 1. Fetch Ambulance with real fields
        const ambulance = await Ambulance.findById(ambulanceId)
            .select('name vehicleNumber vehicleType role clinicId isOnline availableForEmergency')
            .populate('clinicId', 'name clinicName phoneNumber address')
            .lean();

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        // 🚨 2. Independent Ambulance Check (role === 'ambulance')
        if (ambulance.role === 'ambulance' || !ambulance.clinicId) {
            return res.json({
                success: true,
                _id: ambulance._id,
                role: ambulance.role,
                vehicleNumber: ambulance.vehicleNumber,
                isOnline: ambulance.isOnline,
                availableForEmergency: ambulance.availableForEmergency,
                message: "Independent ambulance operates on real-time emergency duty. No time slots needed.",
                totalSlots: 0,
                slots: []
            });
        }

        // 3. Clinic Ambulance (role === 'clinic-ambulance')
        const selectedDate = date || new Date().toISOString().split('T')[0];
        const config = await Availability.findOne({ vendorId: ambulance._id });

        if (!config) {
            return res.json({
                success: true,
                _id: ambulance._id,
                role: ambulance.role,
                clinicId: ambulance.clinicId,
                vehicleNumber: ambulance.vehicleNumber,
                message: `No scheduled time slots configured yet for this ambulance.`,
                totalSlots: 0,
                slots: []
            });
        }

        // Collision Check for Bookings
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

        res.json({
            success: true,
            _id: ambulance._id,
            role: ambulance.role,
            clinicId: ambulance.clinicId,
            vehicleNumber: ambulance.vehicleNumber,
            vehicleType: ambulance.vehicleType,
            selectedDate,
            isClosed: slotResult.isClosed || false,
            totalSlots: (slotResult.slots || []).length,
            slots: slotResult.slots || []
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getNearbyAmbulances,
    getAmbulanceDetailsForUser,
    getClinicAmbulanceSlotsForUser
};