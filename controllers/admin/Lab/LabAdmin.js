// controllers/admin/Lab/LabAdmin.js

const LabBooking = require('../../../models/LabBooking');
const Lab = require('../../../models/Lab');

// --- 1. ADMIN: GET ALL LABS WITH FILTERS & PAGINATION ---
// Endpoint: GET /admin/lab/list?status=Pending&isActive=true&page=1&limit=10
const adminGetLabs = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, isActive, search } = req.query;
        const query = {};

        // Status filter (e.g. Incomplete, Pending, Approved, Rejected)
        if (status) {
            query.profileStatus = status;
        }

        // Active / Inactive filter
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        // Search logic (Checks either Lab Name, Email or Phone case-insensitive)
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const labs = await Lab.find(query)
            .select('-password') // Hide secure password hash
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Lab.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            count: labs.length,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: APPROVE OR REJECT LAB PROFILE STATUS (Unified Endpoint) ---
// Endpoint: PATCH /admin/lab/approve/:labId
const approveLabStatus = async (req, res) => {
    try {
        const { labId } = req.params;
        const { status, rejectionReason } = req.body; // status can be: 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid status value. Allowed: Approved, Rejected, Pending" 
            });
        }

        const lab = await Lab.findById(labId);
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }

        // Set verification status
        lab.profileStatus = status;

        if (status === 'Rejected') {
            if (!rejectionReason || rejectionReason.trim() === "") {
                return res.status(400).json({ 
                    success: false, 
                    message: "Rejection reason is required when status is Rejected." 
                });
            }
            lab.rejectionReason = rejectionReason;
        } else {
            // Clear verification reasons on approval or resetting to pending
            lab.rejectionReason = null;
        }

        await lab.save();

        res.json({
            success: true,
            message: `Lab status successfully updated to ${status}.`,
            data: {
                labId: lab._id,
                profileStatus: lab.profileStatus,
                rejectionReason: lab.rejectionReason
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. ADMIN: TOGGLE ACTIVE/INACTIVE STATUS ---
// Endpoint: PATCH /admin/lab/toggle-active/:labId
const toggleActiveInactiveLab = async (req, res) => {
    try {
        const { labId } = req.params;
        const lab = await Lab.findById(labId);
 
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }
 
        // Toggle the boolean value
        lab.isActive = !lab.isActive;
        await lab.save();
 
        return res.json({
            success: true,
            message: `Lab status updated to ${lab.isActive ? 'Active' : 'Inactive'}.`,
            data: { 
                labId: lab._id,
                isActive: lab.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};

// --- 4. ADMIN: GET APPROVED LABS LIST (Legacy / Quick Retrieval) ---
// Endpoint: GET /admin/lab/approved-list?page=1
const adminGetApprovedLabs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const labs = await Lab.find(query)
            .select('name email phone city profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Lab.countDocuments(query);

        res.json({
            success: true,
            count: labs.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 1. ADMIN: GET LAB VENDORS SORTED BY ORDER COUNT (DECREASING / TOP FIRST)
// Endpoint: GET /admin/lab/vendors-by-orders?page=1&limit=20&search=Dr
// =========================================================================
const adminGetLabsSortedByOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, city, state, profileStatus, isActive } = req.query;

        let matchQuery = {};

        // Status filters
        if (profileStatus) matchQuery.profileStatus = profileStatus;
        if (isActive !== undefined) matchQuery.isActive = (isActive === 'true');
        if (city) matchQuery.city = new RegExp(`^${city.trim()}$`, 'i');
        if (state) matchQuery.state = new RegExp(`^${state.trim()}$`, 'i');

        // Search by lab name, phone, or email
        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            matchQuery.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phone: searchRegex }
            ];
        }

        // MongoDB Aggregation: Count total bookings per lab and sort descending
        const aggregate = await Lab.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labbookings",
                    localField: "_id",
                    foreignField: "labId",
                    as: "bookingsList"
                }
            },
            {
                $addFields: {
                    totalOrders: { $size: "$bookingsList" }, // 👈 Total orders count
                    completedOrders: {
                        $size: {
                            $filter: {
                                input: "$bookingsList",
                                as: "b",
                                cond: { $eq: ["$$b.status", "Completed"] }
                            }
                        }
                    },
                    pendingOrders: {
                        $size: {
                            $filter: {
                                input: "$bookingsList",
                                as: "b",
                                cond: { 
                                    $in: ["$$b.status", ["Pending", "Confirmed", "Testing", "Phlebotomist Assigned"]] 
                                }
                            }
                        }
                    },
                    cancelledOrders: {
                        $size: {
                            $filter: {
                                input: "$bookingsList",
                                as: "b",
                                cond: { $in: ["$$b.status", ["Cancelled", "No-Show"]] }
                            }
                        }
                    },
                    totalRevenue: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: "$bookingsList",
                                        as: "b",
                                        cond: { $eq: ["$$b.status", "Completed"] }
                                    }
                                },
                                as: "comp",
                                in: { $ifNull: ["$$comp.billSummary.totalAmount", 0] }
                            }
                        }
                    }
                }
            },
            {
                $project: {
                    bookingsList: 0,
                    password: 0,
                    __v: 0
                }
            },
            // 🌟 DECREASING SORT: Highest total orders first
            {
                $sort: {
                    totalOrders: -1,
                    createdAt: -1
                }
            },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const total = aggregate[0].metadata[0]?.total || 0;
        const labs = aggregate[0].data || [];

        res.status(200).json({
            success: true,
            total,
            count: labs.length,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: labs
        });
    } catch (error) {
        console.error("adminGetLabsSortedByOrders Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. ADMIN: GET LAB BOOKINGS (When Admin clicks on a specific Vendor)
// Endpoint: GET /admin/lab/bookings?labId=ID&page=1&status=Confirmed
// =========================================================================
const adminGetLabBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { labId, status, search, startDate, endDate, collectionType } = req.query;

        let query = {};

        // Scope to specific vendor if clicked
        if (labId) {
            query.labId = labId;
        }

        if (status && status !== 'All') {
            query.status = status;
        }

        if (collectionType) {
            query.collectionType = collectionType;
        }

        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            query.$or = [
                { bookingId: new RegExp(cleanSearch, 'i') },
                { 'patients.name': new RegExp(cleanSearch, 'i') },
                { 'address.phone': new RegExp(cleanSearch, 'i') }
            ];
        }

        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59))
            };
        }

        const [total, rawBookings] = await Promise.all([
            LabBooking.countDocuments(query),
            LabBooking.find(query)
                .populate('userId', 'name phone email profilePic')
                .populate('labId', 'name city phone profileImage')
                .populate('phlebotomistId', 'name phone vehicleNumber')
                .populate('items.tests.testId', 'testName')
                .populate('items.packages.packageId', 'packageName')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        // Concise summary response for rapid UI rendering
        const formattedOrders = rawBookings.map(b => {
            const testNames = (b.items?.tests || []).map(t => t.name || t.testId?.testName).filter(Boolean);
            const packageNames = (b.items?.packages || []).map(p => p.name || p.packageId?.packageName).filter(Boolean);
            const allItems = [...testNames, ...packageNames];

            return {
                _id: b._id,
                bookingId: b.bookingId,
                bookingType: b.bookingType,
                collectionType: b.collectionType,
                status: b.status,
                appointmentDate: b.appointmentDate,
                appointmentTime: b.appointmentTime,
                lab: {
                    _id: b.labId?._id || null,
                    name: b.labId?.name || "Diagnostic Lab",
                    city: b.labId?.city || ""
                },
                customer: {
                    name: b.userId?.name || "Customer",
                    phone: b.userId?.phone || ""
                },
                patientSummary: {
                    primaryPatientName: b.patients?.[0]?.name || "Patient",
                    totalPatients: b.patients?.length || 1
                },
                itemsSummary: {
                    totalItems: allItems.length,
                    displayNames: allItems.slice(0, 2),
                    hasMore: allItems.length > 2
                },
                totalAmount: b.billSummary?.totalAmount || 0,
                paymentMethod: b.paymentMethod,
                paymentStatus: b.paymentStatus,
                isRapid: (b.billSummary?.rapidDeliveryCharge || 0) > 0,
                phlebotomist: b.phlebotomistId ? {
                    name: b.phlebotomistId.name,
                    phone: b.phlebotomistId.phone
                } : null,
                createdAt: b.createdAt
            };
        });

        res.status(200).json({
            success: true,
            total,
            count: formattedOrders.length,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: formattedOrders
        });
    } catch (error) {
        console.error("adminGetLabBookings Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 3. ADMIN: GET SINGLE LAB BOOKING FULL DETAILS (When Admin clicks an Order)
// Endpoint: GET /admin/lab/bookings/details/:orderId
// =========================================================================
const adminGetLabBookingDetails = async (req, res) => {
    try {
        const { orderId } = req.params;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = isObjectId ? { _id: orderId } : { bookingId: String(orderId).trim() };

        const booking = await LabBooking.findOne(query)
            .populate('userId', 'name phone email profilePic gender age')
            .populate('labId', 'name city state address phone profileImage email location isHomeCollectionAvailable is24x7')
            .populate('phlebotomistId', 'name phone vehicleNumber vehicleType status location profilePic')
            .populate('items.tests.testId', 'testName sampleType discountPrice amount mainCategory reportTime parameters')
            .populate('items.packages.packageId', 'packageName offerPrice mrp sampleTypes reportTime tests')
            .lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Lab booking record not found."
            });
        }

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        console.error("adminGetLabBookingDetails Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
 
module.exports = { 
    adminGetLabs,
    approveLabStatus,
    toggleActiveInactiveLab,
    adminGetApprovedLabs,
    adminGetLabsSortedByOrders,
    adminGetLabBookings,
    adminGetLabBookingDetails
};