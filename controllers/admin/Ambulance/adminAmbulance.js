// controllers/admin/Ambulance/adminAmbulanceController.js

const Ambulance = require('../../../models/Ambulance');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const mongoose = require('mongoose');

// ==========================================
// 🚑 1. GET ALL AMBULANCES (Sorted by Highest Bookings First)
// Endpoint: GET /admin/ambulances/list
// ==========================================
const getAllAmbulancesForAdmin = async (req, res) => {
    try {
        const {
            profileStatus, // 'Pending', 'Approved', 'Rejected', 'Incomplete'
            role,          // 'clinic-ambulance' | 'ambulance'
            search,        // Driver name, vehicle number, phone, city
            page = 1,
            limit = 10
        } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        // 1. Build Match Filter
        let matchQuery = {};

        if (profileStatus && profileStatus !== 'ALL') {
            matchQuery.profileStatus = profileStatus;
        }

        if (role) {
            matchQuery.role = role;
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            matchQuery.$or = [
                { name: regex },
                { vehicleNumber: regex },
                { phone: regex },
                { city: regex },
                { address: regex }
            ];
        }

        // 🎯 2. AGGREGATION PIPELINE: Calculate Total Rides & Sort Descending
        const pipeline = [
            { $match: matchQuery },

            // Join with AmbulanceBookings collection
            {
                $lookup: {
                    from: 'ambulancebookings',
                    localField: '_id',
                    foreignField: 'ambulanceId',
                    as: 'allBookings'
                }
            },

            // Join with Clinics collection (for clinicId details)
            {
                $lookup: {
                    from: 'clinics',
                    localField: 'clinicId',
                    foreignField: '_id',
                    as: 'clinicDetails'
                }
            },

            // Add Total & Completed Rides Count
            {
                $addFields: {
                    totalRidesCount: { $size: '$allBookings' },
                    completedRidesCount: {
                        $size: {
                            $filter: {
                                input: '$allBookings',
                                as: 'b',
                                cond: { $eq: ['$$b.status', 'Completed'] }
                            }
                        }
                    },
                    providerType: {
                        $cond: {
                            if: { $eq: ['$role', 'clinic-ambulance'] },
                            then: 'Clinic Ambulance',
                            else: 'Independent Ambulance'
                        }
                    },
                    clinicId: { $arrayElemAt: ['$clinicDetails', 0] }
                }
            },

            // 🚀 SORT BY HIGHEST BOOKINGS FIRST
            {
                $sort: {
                    totalRidesCount: -1, // Most bookings on TOP
                    createdAt: -1
                }
            },

            // Clean up heavy temporary arrays
            {
                $project: {
                    allBookings: 0,
                    clinicDetails: 0,
                    password: 0,
                    token: 0,
                    fcmToken: 0
                }
            }
        ];

        // 3. Count Total Documents
        const totalDocsCount = await Ambulance.countDocuments(matchQuery);

        // 4. Apply Pagination
        const fleetList = await Ambulance.aggregate([
            ...pipeline,
            { $skip: skip },
            { $limit: limitNum }
        ]);

        res.json({
            success: true,
            totalDocs: totalDocsCount,
            totalPages: Math.ceil(totalDocsCount / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: fleetList.length,
            data: fleetList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 2. GET BOOKINGS OF A SPECIFIC AMBULANCE (OR ALL BOOKINGS)
// Endpoint: GET /admin/ambulances/:ambulanceId/bookings
// ==========================================
const getAmbulanceBookingsForAdmin = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const { status, bookingCategory, page = 1, limit = 10 } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        let query = {};

        if (ambulanceId && ambulanceId !== 'all') {
            if (!mongoose.Types.ObjectId.isValid(ambulanceId)) {
                return res.status(400).json({ success: false, message: "Invalid Ambulance ID format." });
            }
            query.ambulanceId = ambulanceId;
        }

        if (status) query.status = status;
        if (bookingCategory) query.bookingCategory = bookingCategory;

        const totalDocs = await AmbulanceBooking.countDocuments(query);

        const bookings = await AmbulanceBooking.find(query)
            .select('bookingId caseReference bookingCategory rideType status paymentStatus paymentMethod pricing.total scheduledDate scheduledTime estimateTime pickupLocation.address dropoffLocation.address ambulanceId clinicId userId createdAt')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone role')
            .populate('clinicId', 'name clinicName phoneNumber')
            .populate('userId', 'name phone email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: bookings.length,
            data: bookings
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔍 3. GET SINGLE BOOKING FULL DETAILS FOR ADMIN (Audit View)
// Endpoint: GET /admin/ambulances/booking-details/:id
// ==========================================
const getAmbulanceBookingDetailsForAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await AmbulanceBooking.findOne({
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { bookingId: id },
                { caseReference: id }
            ]
        })
        .populate('ambulanceId', 'name vehicleNumber vehicleType phone bloodGroup experienceYears pricing supportStaff documents bankDetails location')
        .populate('clinicId', 'name clinicName phoneNumber address city state image')
        .populate('userId', 'name phone email gender dob profilePic')
        .lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Ambulance booking record not found."
            });
        }

        res.json({
            success: true,
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🚫 4. GET ALL CANCELLED AMBULANCE BOOKINGS (Admin View)
// Endpoint: GET /admin/ambulances/cancelled-bookings
// ==========================================
const getCancelledAmbulanceBookingsForAdmin = async (req, res) => {
    try {
        const {
            bookingCategory, // 'Emergency' | 'Referral'
            search,          // bookingId, caseReference, patient name, phone
            page = 1,
            limit = 10
        } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        // 🎯 STRICT FILTER: Only Cancelled bookings
        let query = { status: 'Cancelled' };

        if (bookingCategory) {
            query.bookingCategory = bookingCategory;
        }

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingId: regex },
                { caseReference: regex },
                { "patientDetails.name": regex },
                { "pickupLocation.address": regex },
                { "dropoffLocation.address": regex }
            ];
        }

        const totalDocs = await AmbulanceBooking.countDocuments(query);

        const cancelledBookings = await AmbulanceBooking.find(query)
            .select('bookingId caseReference bookingCategory rideType status paymentStatus paymentMethod pricing scheduledDate scheduledTime estimateTime pickupLocation.address dropoffLocation.address patientDetails trackingTimeline ambulanceId clinicId userId createdAt updatedAt')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone role')
            .populate('clinicId', 'name clinicName phoneNumber address')
            .populate('userId', 'name phone email')
            .sort({ updatedAt: -1 }) // Most recently cancelled first
            .skip(skip)
            .limit(limitNum)
            .lean();

        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: cancelledBookings.length,
            data: cancelledBookings
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getAllAmbulancesForAdmin,
    getAmbulanceBookingsForAdmin,
    getAmbulanceBookingDetailsForAdmin,
    getCancelledAmbulanceBookingsForAdmin
};