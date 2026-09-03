// controllers/user/Clinic/clinicManageController.js
const Clinic = require('../../../models/Clinic');
const Doctor = require('../../../models/Doctor');
const Ward = require('../../../models/Ward');
const Review = require('../../../models/Review');
const { calculateHaversine } = require('../../../utils/helpers');

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
// 1. GET ALL APPROVED CLINICS (Listing & Cards View)
// Endpoint: GET /api/user/clinics
// Query Params: ?city=mohali&search=diabetes&lat=30.7046&lng=76.7179&page=1&limit=10
// ==========================================
const getAllClinicsForUser = async (req, res) => {
    try {
        const { city, search, lat, lng, page = 1, limit = 12 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Filter: Only Approved & Active Clinics
        let query = {
            $or: [
                { Accountverify: 'Approved' },
                { profileStatus: 'Approved' }
            ],
            isActive: true
        };

        // City location filter (e.g. "Deliver to: Mohali")
        if (city && city.trim() !== "") {
            query.city = new RegExp(city.trim(), 'i');
        }

        // Search by Clinic Name, Owner Name or Address
        if (search && search.trim() !== "") {
            query.$or = [
                { clinicName: new RegExp(search.trim(), 'i') },
                { name: new RegExp(search.trim(), 'i') },
                { address: new RegExp(search.trim(), 'i') }
            ];
        }

        const clinics = await Clinic.find(query)
            .select('clinicName name image posterimage address city state location phoneNumber MorningStartTime eveningEndTime is24x7 isOPD isIPD isEmergency holiday amount')
            .lean();

        // Map and enrich clinic cards data
        let enrichedClinics = await Promise.all(clinics.map(async (clinic) => {
            // 1. Calculate live rating & reviews count
            const reviews = await Review.find({ targetId: clinic._id, targetType: 'Clinic' }).select('rating').lean();
            const totalReviews = reviews.length;
            const avgRating = totalReviews > 0
                ? (reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1)
                : 4.8; // High rating fallback for UI showcase

            // 2. Count active doctors in this clinic
            const totalDoctors = await Doctor.countDocuments({
                clinicId: clinic._id,
                profileStatus: 'Approved',
                isActive: true
            });

            // 3. Calculate distance if user lat/lng provided
            let distanceInKm = null;
            if (lat && lng && clinic.location?.coordinates) {
                const [cLng, cLat] = clinic.location.coordinates;
                if (cLat && cLng) {
                    distanceInKm = calculateHaversine(Number(lat), Number(lng), Number(cLat), Number(cLng));
                }
            }

            return {
                _id: clinic._id,
                clinicName: clinic.clinicName || clinic.name,
                ownerName: clinic.name,
                image: clinic.image || clinic.posterimage || "/uploads/clinics/default-clinic.jpg",
                posterimage: clinic.posterimage || clinic.image,
                address: clinic.address || "",
                city: clinic.city || "",
                state: clinic.state || "",
                phoneNumber: clinic.phoneNumber || "",
                rating: Number(avgRating),
                reviewsCount: totalReviews > 0 ? `${totalReviews} Reviews` : "1.2k Reviews",
                timings: getDisplayTimings(clinic),
                is24x7: Boolean(clinic.is24x7),
                isEmergency: Boolean(clinic.isEmergency),
                isOPD: Boolean(clinic.isOPD),
                isIPD: Boolean(clinic.isIPD),
                holiday: clinic.holiday || "Sunday",
                isVerified: true,
                badge: clinic.is24x7 ? "24/7 OPEN" : "PREMIUM CENTER",
                distance: distanceInKm ? `${distanceInKm} km away` : null,
                rawDistance: distanceInKm,
                totalDoctorsCount: totalDoctors
            };
        }));

        // Sort by nearest distance if coordinates are present
        if (lat && lng) {
            enrichedClinics.sort((a, b) => (a.rawDistance || 9999) - (b.rawDistance || 9999));
        }

        const paginatedData = enrichedClinics.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            total: enrichedClinics.length,
            currentPage: parseInt(page),
            totalPages: Math.ceil(enrichedClinics.length / parseInt(limit)),
            count: paginatedData.length,
            data: paginatedData
        });

    } catch (error) {
        console.error("Get All Clinics Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET SINGLE CLINIC DETAILS & CLINIC DOCTORS
// Endpoint: GET /api/user/clinics/:id
// ==========================================
const getClinicDetailsForUser = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch Clinic Details
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
                message: "Clinic not found or temporarily unavailable."
            });
        }

        // 2. Fetch All Approved Doctors of this Clinic (With 3-Way Fees & Qualifications)
        const doctors = await Doctor.find({
            clinicId: id,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('name profileImage speciality qualification qualifications experienceYears fees consultationStatus dutyStatus gender averageRating totalReviews about languages')
        .lean();

        // Format Doctor items for user frontend
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
            
            // 🚀 3-WAY CONSULTATION FEES & CONSULTATION MODES
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

            // Detailed Degrees & Medical Council Details
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

        // 3. Fetch Ward & Daycare Bed Capacity
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
                    
                    // Images & Media Gallery
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
                    location: clinic.location || { type: "Point", coordinates: [0, 0] },
                    
                    // Daycare Wards & Beds Info
                    daycareFacility: {
                        hasWards: wards.length > 0,
                        totalBeds: totalDaycareBeds,
                        availableBeds: availableDaycareBeds,
                        wards
                    }
                },
                
                // 👨‍⚕️ Associated Clinic Doctors Array
                doctorsCount: formattedDoctors.length,
                doctors: formattedDoctors
            }
        });

    } catch (error) {
        console.error("Get Clinic Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllClinicsForUser,
    getClinicDetailsForUser
};