// controllers/admin/CGM/DiabeticCoachBookings.js

const DiabeticCoachBooking = require('../../../models/DiabeticCoachBooking');
const DiabetesCoach = require('../../../models/DiabetesCoach');
const User = require('../../../models/User');
const mongoose = require('mongoose');

// Helper to escape regex special characters (prevents regex crashes)
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// =========================================================================
// 🚫 1. GET ALL CANCELLED COACH BOOKINGS (DEDICATED CANCELLED LIST)
// Endpoint: GET /admin/cgm/coach-bookings/cancelled
// =========================================================================
const getAdminCancelledCoachBookings = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            paymentMethod,
            consultationMode 
        } = req.query;

        // Base Filter: Strictly Cancelled bookings
        const query = { status: 'Cancelled' };

        if (paymentMethod && paymentMethod.trim() !== '') {
            query.paymentMethod = paymentMethod.trim();
        }

        if (consultationMode && consultationMode.trim() !== '') {
            query.consultationMode = consultationMode.trim();
        }

        // Search Filter (Booking ID, Patient Name, Patient Phone)
        if (search && search.trim() !== '') {
            const sanitizedSearch = escapeRegex(search.trim());
            const regex = new RegExp(sanitizedSearch, 'i');
            query.$or = [
                { bookingId: regex },
                { 'patientDetails.name': regex },
                { 'patientDetails.phone': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await DiabeticCoachBooking.countDocuments(query);

        const cancelledBookings = await DiabeticCoachBooking.find(query)
            .select('_id bookingId coachId userId bookingFor patientDetails consultationMode scheduledDate slotTime locationType pricing.totalPayable paymentMethod paymentStatus status cancellationDetails createdAt updatedAt')
            .populate('coachId', 'name qualification profileImage phone coachType')
            .populate('userId', 'name phone email')
            .sort({ updatedAt: -1 }) // Most recently cancelled first
            .skip(skip)
            .limit(limitNum)
            .lean();

        const formattedData = cancelledBookings.map(b => ({
            _id: b._id,
            bookingId: b.bookingId,
            coach: {
                _id: b.coachId?._id || null,
                name: b.coachId?.name || "Diabetes Coach",
                qualification: b.coachId?.qualification || "Certified Diabetes Educator",
                profileImage: b.coachId?.profileImage || null,
                phone: b.coachId?.phone || "N/A"
            },
            patient: {
                bookingFor: b.bookingFor || "Self",
                name: b.patientDetails?.name || "N/A",
                phone: b.patientDetails?.phone || "N/A",
                relation: b.patientDetails?.relation || "Self",
                isDiabetic: Boolean(b.patientDetails?.isDiabetic),
                diabetesType: b.patientDetails?.diabetesType || "N/A"
            },
            consultationMode: b.consultationMode,
            scheduledDate: b.scheduledDate,
            slotTime: b.slotTime,
            locationType: b.locationType,
            totalPayable: b.pricing?.totalPayable || 0,
            paymentMethod: b.paymentMethod,
            paymentStatus: b.paymentStatus,
            status: b.status,
            cancellationDetails: {
                cancelledBy: b.cancellationDetails?.cancelledBy || "User",
                reason: b.cancellationDetails?.reason || "Cancelled by user before session.",
                cancelledAt: b.cancellationDetails?.cancelledAt || b.updatedAt,
                refundAmount: b.cancellationDetails?.refundAmount || 0,
                refundStatus: b.cancellationDetails?.refundStatus || "Not Applicable"
            },
            bookingDate: b.createdAt
        }));

        res.status(200).json({
            success: true,
            totalCancelled: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 👨‍⚕️ 2. GET ALL COACHES WITH BOOKINGS OVERVIEW STATS (STEP 1)
// Endpoint: GET /admin/cgm/coach-bookings/coaches
// =========================================================================
const getAdminCoachesWithBookingStats = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            coachType, 
            city,
            activeOnly 
        } = req.query;

        const query = {};
        if (activeOnly === 'true') query.isActive = true;
        if (coachType && coachType.trim() !== '') {
            query.coachType = { $in: [coachType.trim(), 'Both'] };
        }
        if (city && city.trim() !== '') {
            query['location.city'] = { $regex: city.trim(), $options: 'i' };
        }

        // Search Filter (Coach Name, Qualification, Phone, Email, City)
        if (search && search.trim() !== '') {
            const sanitizedSearch = escapeRegex(search.trim());
            const regex = new RegExp(sanitizedSearch, 'i');
            query.$or = [
                { name: regex },
                { qualification: regex },
                { phone: regex },
                { email: regex },
                { 'location.city': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await DiabetesCoach.countDocuments(query);

        // Fetch coaches
        const coaches = await DiabetesCoach.find(query)
            .select('-password -token -fcmToken')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // 📊 Aggregate Booking Counts for Each Coach
        const coachIds = coaches.map(c => c._id);
        const bookingStats = await DiabeticCoachBooking.aggregate([
            { $match: { coachId: { $in: coachIds } } },
            {
                $group: {
                    _id: "$coachId",
                    totalBookings: { $sum: 1 },
                    activeBookings: { 
                        $sum: { 
                            $cond: [{ $in: ["$status", ["Placed", "Confirmed", "In-Progress"]] }, 1, 0] 
                        } 
                    },
                    completedBookings: { 
                        $sum: { 
                            $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] 
                        } 
                    },
                    cancelledBookings: { 
                        $sum: { 
                            $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] 
                        } 
                    }
                }
            }
        ]);

        const statsMap = new Map();
        bookingStats.forEach(stat => {
            statsMap.set(stat._id.toString(), stat);
        });

        // Format clean table list for Admin
        const formattedCoaches = coaches.map(c => {
            const stats = statsMap.get(c._id.toString()) || {
                totalBookings: 0,
                activeBookings: 0,
                completedBookings: 0,
                cancelledBookings: 0
            };

            return {
                _id: c._id,
                name: c.name,
                qualification: c.qualification || "Certified Diabetes Educator",
                profileImage: c.profileImage || null,
                coachType: c.coachType || "Both",
                phone: c.phone || "N/A",
                email: c.email || "N/A",
                location: {
                    city: c.location?.city || "N/A",
                    state: c.location?.state || "N/A"
                },
                fees: {
                    online: c.fees?.online || c.price || 299,
                    offline: c.fees?.offline || 599
                },
                rating: c.rating || 4.9,
                totalReviews: c.totalReviews || 0,
                isActive: c.isActive,
                bookingStats: {
                    totalBookings: stats.totalBookings,
                    activeBookings: stats.activeBookings,
                    completedBookings: stats.completedBookings,
                    cancelledBookings: stats.cancelledBookings
                },
                createdAt: c.createdAt
            };
        });

        res.status(200).json({
            success: true,
            totalCoaches: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedCoaches.length,
            data: formattedCoaches
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📋 3. GET ALL BOOKINGS OF A SPECIFIC COACH (STEP 2)
// Endpoint: GET /admin/cgm/coach-bookings/coach/:coachId/bookings
// =========================================================================
const getAdminBookingsByCoachId = async (req, res) => {
    try {
        const { coachId } = req.params;
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            status, 
            consultationMode, 
            locationType 
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(coachId)) {
            return res.status(400).json({ success: false, message: "Invalid Coach ID format." });
        }

        // Check if coach exists
        const coach = await DiabetesCoach.findById(coachId).select('name qualification profileImage phone').lean();
        if (!coach) {
            return res.status(404).json({ success: false, message: "Coach not found." });
        }

        const query = { coachId };

        if (status && status.trim() !== '') {
            query.status = status.trim();
        }
        if (consultationMode && consultationMode.trim() !== '') {
            query.consultationMode = consultationMode.trim();
        }
        if (locationType && locationType.trim() !== '') {
            query.locationType = locationType.trim();
        }

        // Search Filter (Booking ID, Patient Name, Patient Phone)
        if (search && search.trim() !== '') {
            const sanitizedSearch = escapeRegex(search.trim());
            const regex = new RegExp(sanitizedSearch, 'i');
            query.$or = [
                { bookingId: regex },
                { 'patientDetails.name': regex },
                { 'patientDetails.phone': regex }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const totalDocs = await DiabeticCoachBooking.countDocuments(query);

        const bookings = await DiabeticCoachBooking.find(query)
            .select('_id bookingId coachId userId bookingFor patientDetails consultationMode scheduledDate slotTime locationType pricing.totalPayable paymentMethod paymentStatus status sessionOtp createdAt updatedAt')
            .populate('userId', 'name phone email profilePic')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const formattedBookings = bookings.map(b => ({
            _id: b._id,
            bookingId: b.bookingId,
            user: {
                _id: b.userId?._id || null,
                name: b.userId?.name || "App User",
                phone: b.userId?.phone || "N/A",
                email: b.userId?.email || "N/A"
            },
            patient: {
                bookingFor: b.bookingFor || "Self",
                name: b.patientDetails?.name || "N/A",
                phone: b.patientDetails?.phone || "N/A",
                gender: b.patientDetails?.gender || "N/A",
                age: b.patientDetails?.age || null,
                relation: b.patientDetails?.relation || "Self",
                isDiabetic: Boolean(b.patientDetails?.isDiabetic),
                diabetesType: b.patientDetails?.diabetesType || "N/A"
            },
            consultationMode: b.consultationMode,
            scheduledDate: b.scheduledDate,
            slotTime: b.slotTime,
            locationType: b.locationType,
            totalPayable: b.pricing?.totalPayable || 0,
            paymentMethod: b.paymentMethod,
            paymentStatus: b.paymentStatus,
            status: b.status,
            sessionOtp: b.sessionOtp,
            bookingDate: b.createdAt
        }));

        res.status(200).json({
            success: true,
            coach: {
                _id: coach._id,
                name: coach.name,
                qualification: coach.qualification,
                profileImage: coach.profileImage
            },
            totalBookings: totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedBookings.length,
            data: formattedBookings
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🔍 4. GET SINGLE BOOKING COMPLETE DETAILS BY ID (STEP 3 - FULL VIEW)
// Endpoint: GET /admin/cgm/coach-bookings/booking/:id
// =========================================================================
const getAdminCoachBookingDetailById = async (req, res) => {
    try {
        const { id } = req.params;

        // Support both MongoDB _id and Alphanumeric bookingId (e.g. DW-COACH-104928)
        const query = mongoose.Types.ObjectId.isValid(id)
            ? { $or: [{ _id: id }, { bookingId: id }] }
            : { bookingId: id };

        const booking = await DiabeticCoachBooking.findOne(query)
            .populate('coachId', 'name qualification profileImage phone email about languages rating location fees consultationModes')
            .populate('userId', 'name phone email profilePic gender dob')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Coach booking not found." });
        }

        res.status(200).json({
            success: true,
            message: "Coach booking full details fetched successfully.",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAdminCancelledCoachBookings,
    getAdminCoachesWithBookingStats,
    getAdminBookingsByCoachId,
    getAdminCoachBookingDetailById
};