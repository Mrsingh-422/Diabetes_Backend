// controllers/admin/Dashboard/Dashboard.js

const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const FoodBooking = require('../../../models/FoodBooking');
const Appointment = require('../../../models/Appointment'); // Doctor Appointments & Hospital bed admissions

const Doctor = require('../../../models/Doctor');
const Lab = require('../../../models/Lab');
const Pharmacy = require('../../../models/Pharmacy');
const Food = require('../../../models/Food');

const mongoose = require('mongoose');

// --- 1. GET DASHBOARD CARDS SUMMARY STATS ---
// Endpoint: GET /admin/dashboard/order-stats
const getDashboardOrderStats = async (req, res) => {
    try {
        // Parallel queries to fetch counts for better performance
        const [
            // Lab Counts
            labPending, labCompleted, labCancelled,
            // Pharmacy Counts
            pharmacyPending, pharmacyCompleted, pharmacyCancelled,
            // Food Counts
            FoodPending, FoodCompleted, FoodCancelled,
            
            // Doctor (Appointment only) Counts
            doctorPending, doctorCompleted, doctorCancelled,
            
        ] = await Promise.all([
            // Labs status mapping
            LabBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled'] } }),
            LabBooking.countDocuments({ status: 'Completed' }),
            LabBooking.countDocuments({ status: 'Cancelled' }),

            // Pharmacy status mapping
            PharmacyBooking.countDocuments({ status: { $nin: ['Delivered', 'Cancelled'] } }),
            PharmacyBooking.countDocuments({ status: 'Delivered' }),
            PharmacyBooking.countDocuments({ status: 'Cancelled' }),

            // Food status mapping
            FoodBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled'] } }),
            FoodBooking.countDocuments({ status: 'Completed' }),
            FoodBooking.countDocuments({ status: 'Cancelled' }),

            // // Hospital (Admission Only) status mapping
            // Appointment.countDocuments({ bookingType: 'Admission', status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] } }),
            // Appointment.countDocuments({ bookingType: 'Admission', status: 'Completed' }),
            // Appointment.countDocuments({ bookingType: 'Admission', status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] } }),

            // Doctor (Appointment Only) status mapping
            Appointment.countDocuments({ bookingType: 'Appointment', status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor'] } }),
            Appointment.countDocuments({ bookingType: 'Appointment', status: 'Completed' }),
            Appointment.countDocuments({ bookingType: 'Appointment', status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } }),

            
        ]);

        res.json({
            success: true,
            data: {
                lab: { pending: labPending, completed: labCompleted, cancelled: labCancelled },
                pharmacy: { pending: pharmacyPending, completed: pharmacyCompleted, cancelled: pharmacyCancelled },
                Food: { pending: FoodPending, completed: FoodCompleted, cancelled: FoodCancelled },
                doctor: { pending: doctorPending, completed: doctorCompleted, cancelled: doctorCancelled }, // 👈 Added Doctor Appointments Counter
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET LIVE ORDERS FEED (With Dynamic Vendor & Time-Range Filtering) ---
// Endpoint: GET /admin/dashboard/live-feed?page=1&limit=25&vendor=doctor&timeRange=24h
const getLiveOrdersFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;
        const { vendor, timeRange } = req.query; // dynamic query parameters
        // timeRange: 6h, 12h, 24h, 7d, 30d
        // vendor: lab, pharmacy, Food, doctor,

        // 1. Calculate timeRange start date threshold dynamically
        let dateFilter = null;
        if (timeRange) {
            const now = new Date();
            const cleanRange = timeRange.trim().toLowerCase();
            if (cleanRange === '6h' || cleanRange === '6hours') {
                dateFilter = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            } else if (cleanRange === '12h' || cleanRange === '12hours') {
                dateFilter = new Date(now.getTime() - 12 * 60 * 60 * 1000);
            } else if (cleanRange === '24h' || cleanRange === '24hours') {
                dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            } else if (cleanRange === '7d' || cleanRange === '7days') {
                dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            } else if (cleanRange === '30d' || cleanRange === '30days') {
                dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }
        }

        // Create dynamic query object for MongoDB filters
        const query = {};
        if (dateFilter) {
            query.createdAt = { $gte: dateFilter };
        }

        let combinedFeed = [];
        let totalOrders = 0;

        // --- SCENARIO A: Vendor-Specific Filter is provided ---
        if (vendor) {
            const cleanVendor = vendor.trim().toLowerCase();

            if (cleanVendor === 'doctor') {
                const docQuery = { bookingType: 'Appointment', ...query };
                const appointments = await Appointment.find(docQuery)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await Appointment.countDocuments(docQuery);

                combinedFeed = appointments.map(item => ({
                    id: item._id,
                    orderId: item.bookingId || "N/A",
                    vendor: 'Doctor',
                    customer: item.userId?.name || 'Guest User',
                    service: 'Doctor Appointment',
                    status: item.status,
                    amount: item.totalAmount || 0,
                    createdAt: item.createdAt
                }));

            } 

            else if (cleanVendor === 'lab') {
                const labs = await LabBooking.find(query)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await LabBooking.countDocuments(query);

                combinedFeed = labs.map(item => ({
                    id: item._id,
                    orderId: item.bookingId || "N/A",
                    vendor: 'Lab',
                    customer: item.userId?.name || 'Guest User',
                    service: item.items?.tests?.[0]?.name || item.items?.packages?.[0]?.name || 'Lab Test',
                    status: item.status,
                    amount: item.billSummary?.totalAmount || 0,
                    createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'pharmacy') {
                const pharmacies = await PharmacyBooking.find(query)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await PharmacyBooking.countDocuments(query);

                combinedFeed = pharmacies.map(item => ({
                    id: item._id,
                    orderId: item.orderId || "N/A",
                    vendor: 'Pharmacy',
                    customer: item.userId?.name || 'Guest User',
                    service: item.items?.[0]?.name || 'Medicine Delivery',
                    status: item.status,
                    amount: item.billSummary?.totalAmount || 0,
                    createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'Food') {
                const Foods = await FoodBooking.find(query)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await FoodBooking.countDocuments(query);

                combinedFeed = Foods.map(item => ({
                    id: item._id,
                    orderId: item.bookingId || "N/A",
                    vendor: 'Food',
                    customer: item.userId?.name || 'Guest User',
                    service: item.serviceDetails?.title || 'Food Care',
                    status: item.status,
                    amount: item.totalPrice || 0,
                    createdAt: item.createdAt
                }));

            } 
        

        // --- SCENARIO B: No Vendor filter (Combined Live Feed matching timeRange) ---
        } else {
            // Fetching latest 50 items matching dynamic query from each category
            const [labs, pharmacies, Foods, appointments, ] = await Promise.all([
                LabBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                PharmacyBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                FoodBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                Appointment.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
            
            ]);

            const mappedLabs = labs.map(item => ({
                id: item._id,
                orderId: item.bookingId || "N/A",
                vendor: 'Lab',
                customer: item.userId?.name || 'Guest User',
                service: item.items?.tests?.[0]?.name || item.items?.packages?.[0]?.name || 'Lab Test',
                status: item.status,
                amount: item.billSummary?.totalAmount || 0,
                createdAt: item.createdAt
            }));

            const mappedPharmacies = pharmacies.map(item => ({
                id: item._id,
                orderId: item.orderId || "N/A",
                vendor: 'Pharmacy',
                customer: item.userId?.name || 'Guest User',
                service: item.items?.[0]?.name || 'Medicine Delivery',
                status: item.status,
                amount: item.billSummary?.totalAmount || 0,
                createdAt: item.createdAt
            }));

            const mappedFoods = Foods.map(item => ({
                id: item._id,
                orderId: item.bookingId || "N/A",
                vendor: 'Food',
                customer: item.userId?.name || 'Guest User',
                service: item.serviceDetails?.title || 'Food Care',
                status: item.status,
                amount: item.totalPrice || 0,
                createdAt: item.createdAt
            }));

            const mappedAppointments = appointments.map(item => ({
                id: item._id,
                orderId: item.bookingId || "N/A",
                // vendor: item.bookingType === 'Admission' ? 'Hospital' : 'Doctor',
                customer: item.userId?.name || 'Guest User',
                service: item.bookingType === 'Admission' ? 'IPD Booking' : 'Doctor Appointment',
                status: item.status,
                amount: item.totalAmount || 0,
                createdAt: item.createdAt
            }));

        

            // Combine arrays and sort chronologically (Latest first)
            combinedFeed = [
                ...mappedLabs,
                ...mappedPharmacies,
                ...mappedFoods,
                ...mappedAppointments,
            ];

            combinedFeed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Get absolute total order count across database matching timeRange query
            const [totalLabs, totalPharmacies, totalFoods, totalAppointments, ] = await Promise.all([
                LabBooking.countDocuments(query),
                PharmacyBooking.countDocuments(query),
                FoodBooking.countDocuments(query),
                Appointment.countDocuments(query),
            ]);
            totalOrders = totalLabs + totalPharmacies + totalFoods + totalAppointments ;

            // Paginate local combined feed safely
            combinedFeed = combinedFeed.slice(skip, skip + limit);
        }

        res.json({
            success: true,
            totalOrders, // Total filtered order count for badge
            totalPages: Math.ceil(totalOrders / limit),
            currentPage: page,
            data: combinedFeed
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. UPDATED FULL DETAIL API (No Vendor Required) ---
// Endpoint: GET /admin/dashboard/order-details/:id
const getOrderDetail = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: "Order/Booking ID is required." });
        }

        let query = {};
        if (mongoose.Types.ObjectId.isValid(id)) {
            query._id = id;
        } else {
            query.$or = [{ bookingId: id }, { orderId: id }, { caseReference: id }];
        }

        // Parallel lookups across all models
        const [lab, pharmacy, Food, ] = await Promise.all([
            LabBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('labId', 'name city state address profileImage is24x7')
                .populate('phlebotomistId', 'name phone vehicleNumber')
                .populate('prescriptionId'),
            PharmacyBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('pharmacyId', 'name profileImage city address phone')
                .populate('items.medicineId', 'name manufacturers packaging mrp image_url')
                .populate('driverId', 'name phone vehicleNumber'),
            FoodBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('FoodId', 'name profileImage speciality experienceYears phone')
                .populate('assignedStaffId', 'name phone vehicleNumber')
                .populate('selectedConsumables.consumableId'),
            Appointment.findOne(query)
                .populate('userId', 'name phone email')
                .populate('hospitalId', 'name address city state hospitalImage type')
                .populate('doctorId', 'name speciality profileImage fees consultationStatus')
                .populate({
                    path: 'bedId',
                    select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                    populate: {
                        path: 'wardId',
                        select: 'name type description'
                    }
                }),
        
        ]);

        let detail = null;
        let detectedVendor = null;

        if (lab) {
            detail = lab;
            detectedVendor = 'Lab';
        } else if (pharmacy) {
            detail = pharmacy;
            detectedVendor = 'Pharmacy';
        } else if (Food) {
            detail = Food;
            detectedVendor = 'Food';
        }

        if (!detail) {
            return res.status(404).json({ 
                success: false, 
                message: "No order/booking found with the provided ID across any category." 
            });
        }

        res.json({
            success: true,
            vendor: detectedVendor,
            data: detail
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- HELPER FUNCTION: OPTIMIZED MONGOOSE AGGREGATION STATUS COUNTER ---
const getModelStatusCounts = async (Model) => {
    const stats = await Model.aggregate([
        {
            $group: {
                _id: "$profileStatus",
                count: { $sum: 1 }
            }
        }
    ]);

    const formattedStats = {
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        incomplete: 0
    };

    stats.forEach(item => {
        const status = item._id ? item._id.toLowerCase() : 'incomplete';
        if (status === 'approved') formattedStats.approved = item.count;
        else if (status === 'rejected') formattedStats.rejected = item.count;
        else if (status === 'pending') formattedStats.pending = item.count;
        else if (status === 'incomplete') formattedStats.incomplete = item.count;
        
        formattedStats.total += item.count;
    });

    return formattedStats;
};

// --- GET ADMIN DASHBOARD VENDOR STATUS STATS ---
const getAdminDashboardStats = async (req, res) => {
    try {
        const [
            doctors,
            hospitals,
            labs,
            pharmacies,
            Foods,
            
        ] = await Promise.all([
            getModelStatusCounts(Doctor),
            getModelStatusCounts(Lab),
            getModelStatusCounts(Pharmacy),
            getModelStatusCounts(Food),
        ]);

        res.json({
            success: true,
            message: "Dashboard vendor stats fetched successfully.",
            data: {
                doctors,
                labs,
                pharmacies,
                Foods,
            }
        });

    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getDashboardOrderStats,
    getLiveOrdersFeed,
    getOrderDetail,
    getAdminDashboardStats
};