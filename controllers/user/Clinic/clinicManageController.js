// controllers/user/Clinic/clinicManageController.js
const Clinic = require('../../../models/Clinic');
const Doctor = require('../../../models/Doctor');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed'); 
const Review = require('../../../models/Review');
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
// 🏥 1. GET NEAREST CLINICS (POST API - Dynamic Admin KM Limit)
// Endpoint: POST /api/user/clinics/nearest
// ==========================================
const getNearestClinics = async (req, res) => {
    try {
        const { lat, lng, search: bodySearch, city: bodyCity, page: bodyPage, limit: bodyLimit } = req.body || {};
        const { search: querySearch, city: queryCity, page = bodyPage || 1, limit = bodyLimit || 12 } = req.query;

        // User location fallback to Mohali if location is OFF
        const userLat = lat ? Number(lat) : DEFAULT_MOHALI_LAT;
        const userLng = lng ? Number(lng) : DEFAULT_MOHALI_LNG;
        const isDefaultLocation = (!lat || !lng);

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 12;
        const searchTerm = (querySearch || bodySearch || '').trim();
        const cityFilter = (queryCity || bodyCity || '').trim();

        // 🚀 1. DYNAMIC KM LIMIT: Admin configured distance from VendorKMLimit (Case-Insensitive)
        const limitConfig = await VendorKMLimit.findOne({ 
            vendorType: { $regex: /^clinic$/i },
            $or: [{ isActive: true }, { isActive: { $exists: false } }]
        }).lean();

        // Admin database me jo value hogi (e.g. 500) wo yahan dynamically aayegi
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

        if (cityFilter !== "") {
            query.city = new RegExp(cityFilter, 'i');
        }

        if (searchTerm !== "") {
            const searchRegex = new RegExp(searchTerm, 'i');
            query.$or = [
                { clinicName: searchRegex },
                { name: searchRegex },
                { address: searchRegex },
                { city: searchRegex }
            ];
        }

        // 3. Fetch all active clinics
        const clinics = await Clinic.find(query)
            .select('clinicName name image posterimage address city state location phoneNumber MorningStartTime eveningEndTime is24x7 isOPD isIPD isEmergency holiday')
            .lean();

        if (clinics.length === 0) {
            return res.json({
                success: true,
                message: "No active approved clinics found in database.",
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

        // 4. Calculate Distance for every clinic
        for (let clinic of clinics) {
            const { lat: clinicLat, lng: clinicLng } = resolveCoordinates(clinic.location);

            const distance = calculateHaversine(
                userLat,
                userLng,
                clinicLat,
                clinicLng
            );

            // Fetch live average rating
            const reviews = await Review.find({ targetId: clinic._id, targetType: 'Clinic' }).select('rating').lean();
            const totalReviews = reviews.length;
            const avgRating = totalReviews > 0
                ? Number((reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1))
                : 4.8;

            const cardItem = {
                _id: clinic._id,
                clinicName: clinic.clinicName || clinic.name,
                doctorIncharge: clinic.name,
                image: clinic.image || clinic.posterimage || "/uploads/clinics/default-clinic.jpg",
                posterimage: clinic.posterimage || clinic.image,
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

            // Dynamic distance filtering based on Admin KM Limit
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


module.exports = {
    getNearestClinics,
    getClinicDetailsForUser,
    getClinicDoctorsAndBeds
    
};