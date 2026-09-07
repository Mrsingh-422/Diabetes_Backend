// controllers/user/Clinic/clinicManageController.js
const Clinic = require('../../../models/Clinic');
const Doctor = require('../../../models/Doctor');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed'); 
const Review = require('../../../models/Review');
const Ambulance = require('../../../models/Ambulance');
const Specialization = require('../../../models/Specialization'); 

Coupon = require('../../../models/Coupon');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { calculateHaversine } = require('../../../utils/helpers');
const mongoose = require('mongoose');

// 📍 DEFAULT STATIC LOCATION: Mohali Center, Punjab (Jab user location off rakhe)
const DEFAULT_MOHALI_LAT = 30.7046;
const DEFAULT_MOHALI_LNG = 76.7179;

// Helper: Smart Coordinate Resolver (Sabse pehle direct lat/lng dekhta hai, fir coordinates array)
const resolveCoordinates = (location) => {
    let lat = null;
    let lng = null;

    // 1. 🎯 PRIMARY: Check direct lat & lng properties (e.g. lat: 30.677, lng: 76.7171)
    if (location?.lat && location?.lng && (Number(location.lat) !== 0 || Number(location.lng) !== 0)) {
        lat = Number(location.lat);
        lng = Number(location.lng);
    } 
    // 2. 🎯 SECONDARY: Check GeoJSON coordinates [lng, lat]
    else if (location?.coordinates && location.coordinates.length === 2) {
        let val1 = Number(location.coordinates[0]);
        let val2 = Number(location.coordinates[1]);

        if (val1 !== 0 || val2 !== 0) {
            // Auto-detect if swapped (India lat < 45, lng > 50)
            if (val1 < 45 && val2 > 50) {
                lat = val1;
                lng = val2;
            } else {
                lng = val1;
                lat = val2;
            }
        }
    }

    // 3. Fallback to Mohali if coordinates are completely missing/zero
    if (!lat || !lng || (lat === 0 && lng === 0)) {
        lat = DEFAULT_MOHALI_LAT;
        lng = DEFAULT_MOHALI_LNG;
    }

    return { lat, lng };
};

// Helper: Format live display timing string
const getDisplayTimings = (clinic) => {
    if (clinic.is24x7) return "Open 24x7";
    if (clinic.MorningStartTime && clinic.eveningEndTime) {
        return `${clinic.MorningStartTime} - ${clinic.eveningEndTime}`;
    }
    if (clinic.MorningStartTime && clinic.MorningEndTime) {
        return `${clinic.MorningStartTime} - ${clinic.MorningEndTime}`;
    }
    return "09:00 AM - 08:00 PM";
};

// ==========================================
// 🏥 1. GET NEAREST CLINICS (Filter, Search, Pagination & Exact Response Keys)
// Endpoint: POST /api/user/clinics/nearest
// ==========================================
const getNearestClinics = async (req, res) => {
    try {
        const { 
            lat, 
            lng, 
            search: bodySearch, 
            city: bodyCity, 
            state: bodyState,
            is24x7,
            isEmergency,
            isOPD,
            isIPD,
            page: bodyPage, 
            limit: bodyLimit 
        } = req.body || {};

        const { 
            search: querySearch, 
            city: queryCity, 
            state: queryState,
            page = bodyPage || 1, 
            limit = bodyLimit || 12 
        } = req.query;

        // User location fallback to Mohali Center if location is OFF
        const userLat = lat ? Number(lat) : DEFAULT_MOHALI_LAT;
        const userLng = lng ? Number(lng) : DEFAULT_MOHALI_LNG;
        const isDefaultLocation = (!lat || !lng);

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 12;
        const searchTerm = (querySearch || bodySearch || '').trim();
        const cityFilter = (queryCity || bodyCity || '').trim();
        const stateFilter = (queryState || bodyState || '').trim();

        // 1. Dynamic Admin KM Limit (VendorKMLimit)
        const limitConfig = await VendorKMLimit.findOne({ 
            vendorType: { $regex: /^clinic$/i },
            $or: [{ isActive: true }, { isActive: { $exists: false } }]
        }).lean();

        const maxDistanceLimit = (limitConfig && limitConfig.kmLimit !== undefined && limitConfig.kmLimit !== null)
            ? Number(limitConfig.kmLimit) 
            : 500;

        // 2. Base Query: Only Approved & Active Clinics
        let query = {
            $or: [
                { Accountverify: 'Approved' },
                { profileStatus: 'Approved' }
            ],
            isActive: true
        };

        if (cityFilter !== "") query.city = new RegExp(cityFilter, 'i');
        if (stateFilter !== "") query.state = new RegExp(stateFilter, 'i');
        if (is24x7 !== undefined) query.is24x7 = is24x7 === true || is24x7 === 'true';
        if (isEmergency !== undefined) query.isEmergency = isEmergency === true || isEmergency === 'true';
        if (isOPD !== undefined) query.isOPD = isOPD === true || isOPD === 'true';
        if (isIPD !== undefined) query.isIPD = isIPD === true || isIPD === 'true';

        if (searchTerm !== "") {
            const searchRegex = new RegExp(searchTerm, 'i');
            query.$or = [
                { clinicName: searchRegex },
                { name: searchRegex },
                { address: searchRegex },
                { city: searchRegex }
            ];
        }

        // 3. Fetch all matching active clinics
        const clinics = await Clinic.find(query)
            .select('clinicName name image posterimage address city state location phoneNumber MorningStartTime eveningEndTime is24x7 isOPD isIPD isEmergency holiday')
            .lean();

        if (clinics.length === 0) {
            return res.json({
                success: true,
                message: "No active approved clinics found.",
                locationUsed: isDefaultLocation ? "Mohali (Default)" : "User Live Location",
                maxDistanceLimitApplied: `${maxDistanceLimit} km`,
                totalDocs: 0,
                totalPages: 0,
                currentPage: pageNum,
                limit: limitNum,
                count: 0,
                data: []
            });
        }

        const allClinicsWithDistance = [];
        const withinRadiusClinics = [];

        // 4. Calculate Distance & Format Exact Requested Response Keys
        for (let clinic of clinics) {
            const { lat: clinicLat, lng: clinicLng } = resolveCoordinates(clinic.location);

            const distance = calculateHaversine(
                userLat,
                userLng,
                clinicLat,
                clinicLng
            );

            // Fetch live review stats
            const reviews = await Review.find({ targetId: clinic._id, targetType: 'Clinic' }).select('rating').lean();
            const totalReviews = reviews.length;
            const avgRating = totalReviews > 0
                ? Number((reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1))
                : 4.8;

            // 🎯 EXACT REQUESTED RESPONSE OBJECT
            const cardItem = {
                _id: clinic._id,
                clinicName: clinic.clinicName || clinic.name,
                doctorIncharge: clinic.name,
                image: clinic.image || clinic.posterimage || "/uploads/clinics/default-clinic.jpg",
                posterimage: clinic.posterimage || clinic.image || "/uploads/clinics/default-clinic.jpg",
                address: clinic.address || "",
                city: clinic.city || "",
                state: clinic.state || "",
                phoneNumber: clinic.phoneNumber || "",
                rating: avgRating,
                reviewsCount: totalReviews > 0 ? `${totalReviews} Reviews` : "1.2k Reviews",
                timings: getDisplayTimings(clinic),
                is24x7: Boolean(clinic.is24x7),
                isEmergency: Boolean(clinic.isEmergency),
                isOPD: clinic.isOPD !== undefined ? Boolean(clinic.isOPD) : true,
                isIPD: Boolean(clinic.isIPD),
                isVerified: true,
                badge: clinic.is24x7 ? "24/7 OPEN" : (clinic.isEmergency ? "EMERGENCY READY" : "PREMIUM CENTER"),
                distance: Number(distance.toFixed(1)),
                distanceText: `${distance.toFixed(1)} km away`
            };

            allClinicsWithDistance.push(cardItem);

            if (distance <= maxDistanceLimit) {
                withinRadiusClinics.push(cardItem);
            }
        }

        // 5. Nearest Distance First Sorting
        const finalList = withinRadiusClinics.length > 0 ? withinRadiusClinics : allClinicsWithDistance;
        finalList.sort((a, b) => a.distance - b.distance);

        // 6. Pagination
        const totalDocs = finalList.length;
        const skip = (pageNum - 1) * limitNum;
        const paginatedData = finalList.slice(skip, skip + limitNum);

        res.json({
            success: true,
            locationUsed: isDefaultLocation ? "Mohali (Default)" : "User Live Location",
            maxDistanceLimitApplied: `${maxDistanceLimit} km`,
            isOutsideRadiusFallback: withinRadiusClinics.length === 0,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: paginatedData.length,
            data: paginatedData
        });

    } catch (error) {
        console.error("Get Nearest Clinics Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 🏥 2. GET SINGLE CLINIC DETAILS & CLINIC DOCTORS (Full Data on Card Click)
// Endpoint: GET /api/user/clinics/:id
// ==========================================
const getClinicDetailsForUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.query;

        // 🛑 Prevent invalid ObjectId crash
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: `Invalid Clinic ID format: '${id}'`
            });
        }

        // 1. Fetch Clinic Full Profile
        const clinic = await Clinic.findOne({
            _id: id,
            $or: [
                { Accountverify: 'Approved' },
                { profileStatus: 'Approved' }
            ],
            isActive: true
        })
        .select('-password -token -phnOtp -bankDetails -rejectionReason')
        .lean();

        if (!clinic) {
            return res.status(404).json({
                success: false,
                message: "Clinic not found or currently unavailable."
            });
        }

        const targetLat = lat ? Number(lat) : DEFAULT_MOHALI_LAT;
        const targetLng = lng ? Number(lng) : DEFAULT_MOHALI_LNG;
        const { lat: clinicLat, lng: clinicLng } = resolveCoordinates(clinic.location);

        const dist = calculateHaversine(targetLat, targetLng, clinicLat, clinicLng);
        const distanceText = `${dist.toFixed(1)} km away`;

        // 2. Fetch Associated Doctors (With 3-Way Fees & Qualifications)
        const doctors = await Doctor.find({
            clinicId: id,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('name profileImage speciality qualification qualifications experienceYears fees consultationStatus dutyStatus gender averageRating totalReviews about languages')
        .lean();

        const formattedDoctors = doctors.map(doc => ({
            _id: doc._id,
            name: doc.name,
            profileImage: doc.profileImage || "/uploads/doctors/default-doctor.png",
            speciality: doc.speciality || "General Physician",
            qualification: doc.qualification || "MBBS",
            experience: `${doc.experienceYears || 0} Years Experience`,
            gender: doc.gender || "Male",
            dutyStatus: doc.dutyStatus || "On Duty",
            rating: doc.averageRating || 4.9,
            reviewsCount: doc.totalReviews || 0,
            
            // 🚀 3-WAY FEES
            fees: {
                clinicVisit: {
                    price: doc.fees?.clinic || 0,
                    isAvailable: doc.consultationStatus?.clinic !== false
                },
                onlineConsult: {
                    price: doc.fees?.online || 0,
                    isAvailable: doc.consultationStatus?.online !== false
                },
                homeVisit: {
                    price: doc.fees?.home || 0,
                    isAvailable: doc.consultationStatus?.home !== false
                }
            },

            degreesList: (doc.qualifications && doc.qualifications.length > 0)
                ? doc.qualifications.map(q => ({
                    degree: q.degree,
                    college: q.college,
                    year: q.year,
                    councilName: q.councilName || "",
                    registrationNo: q.registrationNo || "",
                    stateName: q.stateName || ""
                }))
                : [{ degree: doc.qualification || "MBBS", college: "", year: "" }]
        }));

        // 3. Fetch Wards & Daycare Beds Info
        const wards = await Ward.find({ clinicId: id, isActive: true })
            .select('name type totalBeds availableBeds pricePerDay')
            .lean();

        const totalDaycareBeds = wards.reduce((sum, w) => sum + w.totalBeds, 0);
        const availableDaycareBeds = wards.reduce((sum, w) => sum + w.availableBeds, 0);

        // 4. Combine Full Response
        res.json({
            success: true,
            data: {
                clinicDetails: {
                    _id: clinic._id,
                    clinicName: clinic.clinicName || clinic.name,
                    doctorIncharge: clinic.name,
                    about: clinic.About || "Comprehensive diabetes care and multi-specialty clinical facility.",
                    address: clinic.address || "",
                    city: clinic.city || "",
                    state: clinic.state || "",
                    country: clinic.country || "India",
                    phoneNumber: clinic.phoneNumber || "",
                    alternatePhoneNumber: clinic.alternatePhoneNumber || "",
                    email: clinic.email || "",
                    distanceText,
                    
                    // Gallery & Media
                    mainImage: clinic.image || clinic.posterimage || "",
                    posterImage: clinic.posterimage || "",
                    clinicImages: (clinic.clinicImages && clinic.clinicImages.length > 0)
                        ? clinic.clinicImages
                        : [clinic.image].filter(Boolean),
                    achievementImages: clinic.achievementImages || [],

                    // Timings & Facilities
                    timings: {
                        displayTime: getDisplayTimings(clinic),
                        is24x7: Boolean(clinic.is24x7),
                        morningShift: `${clinic.MorningStartTime || '09:00 AM'} - ${clinic.MorningEndTime || '01:00 PM'}`,
                        eveningShift: `${clinic.eveningStartTime || '02:00 PM'} - ${clinic.eveningEndTime || '06:00 PM'}`,
                        weeklyHoliday: clinic.holiday || "Sunday",
                        workingDays: `${clinic.startDay || 'Monday'} - ${clinic.endDay || 'Saturday'}`
                    },
                    facilities: {
                        isOPD: clinic.isOPD !== undefined ? clinic.isOPD : true,
                        isIPD: Boolean(clinic.isIPD),
                        isEmergency: Boolean(clinic.isEmergency),
                        is24x7: Boolean(clinic.is24x7)
                    },
                    serviceTimings: {
                        emergency: clinic.emergencyTimings || { is24x7: Boolean(clinic.is24x7), startTime: "", endTime: "" },
                        ipd: clinic.ipdTimings || { is24x7: Boolean(clinic.is24x7), startTime: "", endTime: "" },
                        opd: clinic.opdTimings || { is24x7: Boolean(clinic.is24x7), startTime: "", endTime: "" }
                    },
                    location: clinic.location || { type: "Point", coordinates: [0, 0] },
                    
                    // Daycare Wards & Beds Info
                    daycareFacility: {
                        hasWards: wards.length > 0,
                        totalBeds: totalDaycareBeds,
                        availableBeds: availableDaycareBeds,
                        wards
                    }
                },
                
                // 👨‍⚕️ Associated Clinic Doctors
                doctorsCount: formattedDoctors.length,
                doctors: formattedDoctors
            }
        });

    } catch (error) {
        console.error("Get Clinic Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
//  GET CLINIC DOCTORS & WARD/BED DETAILS (Combined Single API)
// Endpoint: GET /api/user/clinics/:clinicId/doctors-and-beds
// ==========================================
const getClinicDoctorsAndBeds = async (req, res) => {
    try {
        const { clinicId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(clinicId)) {
            return res.status(400).json({ success: false, message: `Invalid Clinic ID format: '${clinicId}'` });
        }

        // 1. Verify Clinic exists & fetch minimal name only
        const clinic = await Clinic.findById(clinicId).select('clinicName name').lean();
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        const clinicName = clinic.clinicName || clinic.name;

        // 2. Fetch Doctors of this Clinic
        const doctors = await Doctor.find({
            clinicId,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('name profileImage speciality qualification qualifications experienceYears fees consultationStatus gender averageRating totalReviews')
        .lean();

        const formattedDoctors = doctors.map(doc => ({
            _id: doc._id,
            name: doc.name,
            profileImage: doc.profileImage || "/uploads/doctors/default-doctor.png",
            speciality: doc.speciality || "General Physician",
            degree: doc.qualification || "MBBS",
            experience: `${doc.experienceYears || 0} Years Experience`,
            gender: doc.gender || "Male",
            rating: doc.averageRating || 4.9,
            reviewsCount: doc.totalReviews || 0,
            associatedClinic: {
                clinicId: clinicId,
                clinicName: clinicName
            },
            fees: {
                clinicVisitFee: {
                    price: doc.fees?.clinic || 0,
                    isAvailable: doc.consultationStatus?.clinic !== false
                },
                onlineConsultFee: {
                    price: doc.fees?.online || 0,
                    isAvailable: doc.consultationStatus?.online !== false
                },
                homeVisitFee: {
                    price: doc.fees?.home || 0,
                    isAvailable: doc.consultationStatus?.home !== false
                }
            },
            degreesList: (doc.qualifications && doc.qualifications.length > 0)
                ? doc.qualifications.map(q => ({
                    degree: q.degree,
                    college: q.college,
                    year: q.year,
                    councilName: q.councilName || "",
                    registrationNo: q.registrationNo || "",
                    stateName: q.stateName || ""
                }))
                : [{ degree: doc.qualification || "MBBS", college: "", year: "" }]
        }));

        // 3. Fetch Wards & Bed Units
        const wards = await Ward.find({ clinicId, isActive: true })
            .select('name type totalBeds availableBeds pricePerDay')
            .lean();

        // 4. Fetch Bed Details for each ward
        const wardIds = wards.map(w => w._id);
        const beds = await Bed.find({ clinicId, wardId: { $in: wardIds } })
            .select('bedNumber status pricePerDay wardId')
            .lean();

        const formattedWards = wards.map(ward => {
            const wardBeds = beds.filter(b => b.wardId.toString() === ward._id.toString());
            return {
                wardId: ward._id,
                wardName: ward.name,
                wardType: ward.type,
                totalBeds: ward.totalBeds,
                availableBeds: ward.availableBeds,
                occupiedBeds: Math.max(0, ward.totalBeds - ward.availableBeds),
                pricePerDay: ward.pricePerDay,
                beds: wardBeds.map(b => ({
                    bedId: b._id,
                    bedNumber: b.bedNumber,
                    status: b.status,
                    pricePerDay: b.pricePerDay
                }))
            };
        });

        const totalBedsCount = wards.reduce((sum, w) => sum + w.totalBeds, 0);
        const availableBedsCount = wards.reduce((sum, w) => sum + w.availableBeds, 0);

        // 5. Response (Only Clinic ID/Name + Doctors + Wards & Beds)
        res.json({
            success: true,
            clinicId: clinicId,
            clinicName: clinicName,
            doctorsCount: formattedDoctors.length,
            doctors: formattedDoctors,
            wardBedSummary: {
                totalWardsCount: wards.length,
                totalBeds: totalBedsCount,
                availableBeds: availableBedsCount,
                occupiedBeds: Math.max(0, totalBedsCount - availableBedsCount),
                wards: formattedWards
            }
        });

    } catch (error) {
        console.error("Get Clinic Doctors & Beds Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 🎟️ GET APPLICABLE COUPONS FOR CLINIC (User Side)
// Endpoint: GET /api/user/clinics/coupons/:clinicId
// (Clinic ke khud ke coupons + Admin ke banaye Clinic & All coupons)
// ==========================================
const getClinicCouponsForUser = async (req, res) => {
    try {
        const { clinicId } = req.params;
        const now = new Date();

        // Query: Active coupons only + Expiry date must be in future
        let couponQuery = {
            isActive: true,
            expiryDate: { $gt: now },
            startDate: { $lte: now },
            $or: [
                { isAdminCreated: true, vendorType: { $in: ['Clinic', 'All'] } } // 1. Admin Global Coupons
            ]
        };

        // 2. Agar clinicId aayi hai toh us clinic ke specific coupons bhi include karein
        if (clinicId && mongoose.Types.ObjectId.isValid(clinicId)) {
            couponQuery.$or.push({ 
                vendorId: clinicId, 
                vendorType: 'Clinic',
                isAdminCreated: false 
            });
        }

        const coupons = await Coupon.find(couponQuery)
            .select('couponName discountPercentage maxDiscount minOrderAmount maxUsagePerUser startDate expiryDate vendorType isAdminCreated')
            .sort({ discountPercentage: -1 }) // Highest discount first
            .lean();

        res.json({
            success: true,
            count: coupons.length,
            data: coupons
        });

    } catch (error) {
        console.error("Get Clinic Coupons Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 🚑 GET ALL AMBULANCES OF A CLINIC (User View)
// Endpoint: GET /api/user/clinics/ambulances/:clinicId?lat=...&lng=...
// ==========================================
const getClinicAmbulancesForUser = async (req, res) => {
    try {
        const { clinicId } = req.params;
        const { lat, lng } = req.query;

        if (!mongoose.Types.ObjectId.isValid(clinicId)) {
            return res.status(400).json({ success: false, message: `Invalid Clinic ID: '${clinicId}'` });
        }

        // 1. Check if Clinic exists & has Ambulance service enabled
        const clinic = await Clinic.findById(clinicId).select('clinicName name isAmbulanceAvailable location').lean();
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        if (clinic.isAmbulanceAvailable === false) {
            return res.json({
                success: true,
                clinicId,
                clinicName: clinic.clinicName || clinic.name,
                isAmbulanceAvailable: false,
                message: "Ambulance facility is currently not offered by this clinic.",
                count: 0,
                data: []
            });
        }

        // 2. Fetch all Approved & Active Ambulances for this Clinic
        const ambulances = await Ambulance.find({
            clinicId,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('-password -token -fcmToken -bankDetails -hospitalId')
        .lean();

        const userLat = lat ? Number(lat) : null;
        const userLng = lng ? Number(lng) : null;

        // 3. Format Response with Support Staff, Pricing & Live Distance
        const formattedAmbulances = ambulances.map(amb => {
            let distanceText = null;
            let rawDistance = null;

            if (userLat && userLng && amb.location?.lat && amb.location?.lng && (amb.location.lat !== 0 || amb.location.lng !== 0)) {
                const dist = calculateHaversine(userLat, userLng, Number(amb.location.lat), Number(amb.location.lng));
                rawDistance = Number(dist.toFixed(1));
                distanceText = `${dist.toFixed(1)} km away`;
            }

            return {
                _id: amb._id,
                clinicId: amb.clinicId,
                driverName: amb.name,
                phone: amb.phone,
                email: amb.email || "",
                vehicleNumber: amb.vehicleNumber,
                vehicleType: amb.vehicleType || "Van",
                bloodGroup: amb.bloodGroup || "",
                experienceYears: amb.experienceYears ? `${amb.experienceYears} Years` : "",
                availableForEmergency: Boolean(amb.availableForEmergency),
                isOnline: Boolean(amb.isOnline),
                serviceRadius: amb.serviceRadius || "15 km",
                rating: amb.averageRating || 4.8,
                reviewsCount: amb.totalReviews || 0,
                
                // 🚀 Support Staff (Nurse & Doctor)
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

                // 🚀 Ride Pricing Structure
                pricing: {
                    singleRidePrice: amb.pricing?.singleRidePrice || 400,
                    doubleRidePrice: amb.pricing?.doubleRidePrice || 700,
                    baseDistance: amb.pricing?.baseDistance || 5,
                    pricePerKM: amb.pricing?.pricePerKM || 12
                },

                location: amb.location || { lat: 0, lng: 0 },
                distance: rawDistance,
                distanceText
            };
        });

        res.json({
            success: true,
            clinicId,
            clinicName: clinic.clinicName || clinic.name,
            isAmbulanceAvailable: true,
            count: formattedAmbulances.length,
            data: formattedAmbulances
        });

    } catch (error) {
        console.error("Get Clinic Ambulances Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🔍 2. LIVE CLINIC, DOCTOR & SPECIALITY SEARCH SUGGESTIONS (2-Letter Auto-Suggest)
// Endpoint: POST /api/user/clinics/search-suggestions
// ==========================================
const getClinicSearchSuggestions = async (req, res) => {
    try {
        const { query, q, search, limit = 10 } = req.body || {};
        const queryTerm = (query || q || search || '').trim();

        // 🛡️ 2 characters se kam hone par empty list return karein
        if (!queryTerm || queryTerm.length < 2) {
            return res.json({
                success: true,
                query: queryTerm,
                count: 0,
                data: []
            });
        }

        const searchRegex = new RegExp(queryTerm, 'i');
        const limitNum = parseInt(limit, 10) || 10;

        // 1. Search in Verified Clinics
        const clinics = await Clinic.find({
            $or: [
                { Accountverify: 'Approved' },
                { profileStatus: 'Approved' }
            ],
            isActive: true,
            $and: [
                {
                    $or: [
                        { clinicName: searchRegex },
                        { name: searchRegex },
                        { address: searchRegex },
                        { city: searchRegex }
                    ]
                }
            ]
        })
        .select('clinicName name image address city state')
        .limit(limitNum)
        .lean();

        const formattedClinics = clinics.map(c => ({
            id: c._id,
            _id: c._id,
            name: c.clinicName || c.name,
            description: `${c.city || ''}, ${c.state || ''} • ${c.address || 'Clinic Center'}`,
            imageUrl: c.image || null,
            itemType: "Clinic",
            redirectPath: `/clinic/clinicdetail/${c._id}` // Direct click navigation
        }));

        // 2. Search in Clinic Doctors
        const doctors = await Doctor.find({
            profileStatus: 'Approved',
            isActive: true,
            clinicId: { $ne: null, $exists: true },
            $or: [
                { name: searchRegex },
                { speciality: searchRegex },
                { qualification: searchRegex }
            ]
        })
        .select('name speciality qualification profileImage clinicId fees experienceYears')
        .populate('clinicId', 'clinicName name city')
        .limit(limitNum)
        .lean();

        const formattedDoctors = doctors.map(doc => ({
            id: doc._id,
            _id: doc._id,
            name: doc.name,
            description: `${doc.speciality || 'Specialist'} (${doc.qualification || 'MBBS'}) • ${doc.clinicId?.clinicName || 'Clinic Doctor'}`,
            imageUrl: doc.profileImage || null,
            itemType: "Doctor",
            redirectPath: `/clinic/clinicdetail/${doc.clinicId?._id || doc.clinicId}` //  Navigates to that Clinic profile
        }));

        // 3. Search in Master Specializations
        const specializations = await Specialization.find({
            isActive: true,
            name: searchRegex
        })
        .limit(5)
        .lean();

        const formattedSpecializations = specializations.map(spec => ({
            id: spec._id,
            _id: spec._id,
            name: spec.name,
            description: "Medical Speciality",
            imageUrl: null,
            itemType: "Speciality",
            redirectPath: `/clinics?speciality=${encodeURIComponent(spec.name)}`
        }));

        // 4. Combine Results (Top 15 suggestions)
        const allSuggestions = [
            ...formattedClinics,
            ...formattedDoctors,
            ...formattedSpecializations
        ];

        res.json({
            success: true,
            query: queryTerm,
            count: allSuggestions.length,
            data: allSuggestions.slice(0, 15)
        });

    } catch (error) {
        console.error("Search Suggestions Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getNearestClinics,
    getClinicDetailsForUser,
    getClinicDoctorsAndBeds,
    getClinicCouponsForUser,
    getClinicAmbulancesForUser,
    getClinicSearchSuggestions,
    
};