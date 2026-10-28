const PharmacyBooking = require('../../../models/PharmacyBooking');
const Pharmacy = require('../../../models/Pharmacy');
const mongoose = require('mongoose');
const moment = require('moment');

// =========================================================================
// 1. ADMIN: GET APPROVED PHARMACIES LIST (Limit: 25)
// Endpoint: GET /admin/pharmacy/approved-list?page=1
// =========================================================================
const adminGetApprovedPharmacies = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const pharmacies = await Pharmacy.find(query)
            .select('name email phone city profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Pharmacy.countDocuments(query);

        res.json({
            success: true,
            count: pharmacies.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: pharmacies
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. STEP 1: GET PHARMACY VENDORS LIST FOR ORDERS SCREEN (With Order Stats)
// Endpoint: GET /admin/pharmacy/vendors-list?page=1&limit=25
// =========================================================================
const adminGetPharmacyVendorsForOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const total = await Pharmacy.countDocuments(query);
        const pharmacies = await Pharmacy.find(query)
            .select('name email phone city state address profileImage isActive createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Har pharmacy ke active aur total orders calculate karein
        const vendorsWithStats = await Promise.all(pharmacies.map(async (pharma) => {
            const totalOrders = await PharmacyBooking.countDocuments({ pharmacyId: pharma._id });
            const pendingOrders = await PharmacyBooking.countDocuments({ 
                pharmacyId: pharma._id, 
                status: { $in: ['Placed', 'Packed', 'Shipped', 'Pending'] } 
            });

            return {
                _id: pharma._id,
                name: pharma.name,
                email: pharma.email,
                phone: pharma.phone,
                city: pharma.city,
                state: pharma.state,
                address: pharma.address,
                profileImage: pharma.profileImage,
                isActive: pharma.isActive,
                totalOrders,
                pendingOrders
            };
        }));

        res.status(200).json({
            success: true,
            total,
            count: vendorsWithStats.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: vendorsWithStats
        });
    } catch (error) {
        console.error("adminGetPharmacyVendorsForOrders Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 3. STEP 2: GET ORDERS OF A SELECTED PHARMACY VENDOR (On Click)
// Endpoint: GET /admin/pharmacy/vendors/:pharmacyId/orders?page=1&limit=20
// =========================================================================
const adminGetOrdersByPharmacyId = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const { status, orderType, isRapid, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitVal = parseInt(limit);

        if (!mongoose.Types.ObjectId.isValid(pharmacyId)) {
            return res.status(400).json({ success: false, message: "Invalid Pharmacy ID format." });
        }

        let matchQuery = { 
            pharmacyId: new mongoose.Types.ObjectId(pharmacyId) 
        };

        if (status) matchQuery.status = status;
        if (orderType) matchQuery.orderType = orderType;
        if (isRapid !== undefined) matchQuery.isRapid = isRapid === 'true';

        const total = await PharmacyBooking.countDocuments(matchQuery);

        // Sorting: Active orders top par, Delivered orders sabse last mein
        const pipeline = [
            { $match: matchQuery },
            {
                $addFields: {
                    deliveryPriority: {
                        $cond: {
                            if: { $in: ["$status", ["Delivered", "Completed"]] },
                            then: 1,
                            else: 0
                        }
                    }
                }
            },
            {
                $sort: {
                    deliveryPriority: 1,
                    createdAt: -1
                }
            },
            { $skip: skip },
            { $limit: limitVal }
        ];

        let orders = await PharmacyBooking.aggregate(pipeline);
        orders = await PharmacyBooking.populate(orders, [
            { path: 'userId', select: 'name phone email' },
            { path: 'driverId', select: 'name phone vehicleNumber' },
            { path: 'pharmacyId', select: 'name city phone' }
        ]);

        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            orderType: order.orderType || 'General',
            status: order.status,
            deliveryStatus: order.deliveryStatus,
            isRapid: Boolean(order.isRapid),
            customer: {
                id: order.userId?._id || null,
                name: order.userId?.name || order.address?.name || "Customer",
                phone: order.userId?.phone || order.address?.phone || ""
            },
            pharmacy: {
                id: order.pharmacyId?._id || null,
                name: order.pharmacyId?.name || "Pharmacy Store",
                city: order.pharmacyId?.city || "",
                phone: order.pharmacyId?.phone || ""
            },
            collectionType: order.collectionType,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalAmount: order.billSummary?.totalAmount || 0,
            itemsCount: order.items?.length || 0,
            itemsSummary: (order.items || []).map(item => ({
                name: item.name,
                quantity: item.quantity
            })),
            assignedDriver: order.driverId ? {
                id: order.driverId._id,
                name: order.driverId.name,
                phone: order.driverId.phone,
                vehicleNumber: order.driverId.vehicleNumber
            } : null,
            createdAt: order.createdAt,
            formattedDate: moment(order.createdAt).format('DD MMM YYYY, hh:mm A')
        }));

        res.status(200).json({
            success: true,
            total,
            count: formattedOrders.length,
            totalPages: Math.ceil(total / limitVal),
            currentPage: parseInt(page),
            data: formattedOrders
        });
    } catch (error) {
        console.error("adminGetOrdersByPharmacyId Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 4. STEP 3: GET COMPLETE ORDER DETAILS (Full Medicine, Vendor, User & Bill)
// Endpoint: GET /admin/pharmacy/bookings/details/:orderId
// =========================================================================
const adminGetPharmacyBookingDetails = async (req, res) => {
    try {
        const { orderId } = req.params;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(orderId) : new mongoose.Types.ObjectId() },
                { orderId: String(orderId).trim() }
            ]
        };

        const order = await PharmacyBooking.findOne(query)
            .populate('userId', 'name email phone gender dob age profilePic')
            .populate({
                path: 'pharmacyId',
                select: 'name email phone address city state country profileImage documents.gstNumber documents.drugLicenseNumber documents.cinNumber'
            })
            .populate('driverId', 'name phone vehicleNumber vehicleType profilePic status')
            .populate('items.medicineId', 'name packaging image_url salt_composition')
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Pharmacy order details not found." });
        }

        res.status(200).json({
            success: true,
            data: {
                _id: order._id,
                orderId: order.orderId,
                status: order.status,
                deliveryStatus: order.deliveryStatus,
                orderType: order.orderType || 'General',
                isRapid: Boolean(order.isRapid),
                deliveryOTP: order.deliveryOTP || null,
                anyIntruction: order.anyIntruction || "",
                createdAt: order.createdAt,
                formattedDate: moment(order.createdAt).format('DD MMM YYYY, hh:mm A'),

                customer: order.userId ? {
                    id: order.userId._id,
                    name: order.userId.name,
                    phone: order.userId.phone,
                    email: order.userId.email,
                    gender: order.userId.gender,
                    age: order.userId.age || null
                } : null,
                deliveryAddress: order.address,

                vendor: order.pharmacyId ? {
                    id: order.pharmacyId._id,
                    name: order.pharmacyId.name,
                    email: order.pharmacyId.email,
                    phone: order.pharmacyId.phone,
                    address: order.pharmacyId.address,
                    city: order.pharmacyId.city,
                    state: order.pharmacyId.state,
                    country: order.pharmacyId.country,
                    gstNumber: order.pharmacyId.documents?.gstNumber || "N/A",
                    drugLicenseNumber: order.pharmacyId.documents?.drugLicenseNumber || "N/A",
                    cinNumber: order.pharmacyId.documents?.cinNumber || "N/A"
                } : null,

                itemsCount: order.items?.length || 0,
                items: (order.items || []).map(item => ({
                    medicineId: item.medicineId?._id || item.medicineId,
                    name: item.name,
                    image: item.medicineId?.image_url?.[0] || null,
                    packaging: item.medicineId?.packaging || "10 tablets in 1 strip",
                    mrp: item.mrp || 0,
                    price: item.price,
                    quantity: item.quantity,
                    duration: item.duration || "Full Course",
                    hsn_number: item.hsn_number || "N/A",
                    taxableAmount: item.taxableAmount || 0,
                    cgstAmount: item.cgstAmount || 0,
                    sgstAmount: item.sgstAmount || 0,
                    isReturnAllowed: Boolean(item.isReturnAllowed),
                    isReplacementAllowed: Boolean(item.isReplacementAllowed)
                })),

                billSummary: {
                    itemTotal: order.billSummary?.itemTotal || 0,
                    originalItemTotal: order.billSummary?.originalItemTotal || 0,
                    comboSavings: order.billSummary?.comboSavings || 0,
                    couponDiscount: order.billSummary?.couponDiscount || 0,
                    deliveryCharge: order.billSummary?.deliveryCharge || 0,
                    rapidDeliveryCharge: order.billSummary?.rapidDeliveryCharge || 0,
                    slotCharge: order.billSummary?.slotCharge || 0,
                    taxableTotal: order.billSummary?.taxableTotal || 0,
                    cgstTotal: order.billSummary?.cgstTotal || 0,
                    sgstTotal: order.billSummary?.sgstTotal || 0,
                    cancellationFeeApplied: order.billSummary?.cancellationFeeApplied || 0,
                    totalAmount: order.billSummary?.totalAmount || 0
                },

                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                paymentDetails: order.paymentDetails,

                assignedDriver: order.driverId ? {
                    id: order.driverId._id,
                    name: order.driverId.name,
                    phone: order.driverId.phone,
                    vehicleNumber: order.driverId.vehicleNumber,
                    vehicleType: order.driverId.vehicleType
                } : null,
                prescriptionImages: order.prescriptionImages || [],
                returnDetails: order.returnDetails || null
            }
        });
    } catch (error) {
        console.error("adminGetPharmacyBookingDetails Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 5. STEP 4: GET ONLY CANCELLED ORDERS (Dedicated Cancelled Orders API)
// Endpoint: GET /admin/pharmacy/cancelled-orders?page=1&limit=20
// =========================================================================
const adminGetCancelledPharmacyOrders = async (req, res) => {
    try {
        const { pharmacyId, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitVal = parseInt(limit);

        let query = {
            $or: [
                { status: 'Cancelled' },
                { deliveryStatus: 'CancelledByDriver' }
            ]
        };

        if (pharmacyId && mongoose.Types.ObjectId.isValid(pharmacyId)) {
            query.pharmacyId = new mongoose.Types.ObjectId(pharmacyId);
        }

        const total = await PharmacyBooking.countDocuments(query);
        const cancelledOrders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('pharmacyId', 'name city phone profileImage')
            .populate('driverId', 'name phone vehicleNumber')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limitVal)
            .lean();

        const formattedCancelledOrders = cancelledOrders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            orderType: order.orderType || 'General',
            status: order.status,
            deliveryStatus: order.deliveryStatus,
            cancelReason: order.cancelReason || "Cancelled by customer/store",
            
            customer: {
                id: order.userId?._id || null,
                name: order.userId?.name || order.address?.name || "Customer",
                phone: order.userId?.phone || order.address?.phone || ""
            },
            pharmacy: {
                id: order.pharmacyId?._id || null,
                name: order.pharmacyId?.name || "Pharmacy Store",
                city: order.pharmacyId?.city || "",
                phone: order.pharmacyId?.phone || ""
            },
            
            totalAmount: order.billSummary?.totalAmount || 0,
            cancellationFeeApplied: order.billSummary?.cancellationFeeApplied || 0,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,

            itemsCount: order.items?.length || 0,
            itemsSummary: (order.items || []).map(i => ({
                name: i.name,
                quantity: i.quantity,
                price: i.price
            })),

            cancelledAt: order.updatedAt,
            formattedCancelledDate: moment(order.updatedAt).format('DD MMM YYYY, hh:mm A')
        }));

        res.status(200).json({
            success: true,
            total,
            count: formattedCancelledOrders.length,
            totalPages: Math.ceil(total / limitVal),
            currentPage: parseInt(page),
            data: formattedCancelledOrders
        });
    } catch (error) {
        console.error("adminGetCancelledPharmacyOrders Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 6. ADMIN: GET ALL GLOBAL PHARMACY BOOKINGS (Lightweight Table View)
// Endpoint: GET /admin/pharmacy/bookings?page=1&limit=25
// =========================================================================
const adminGetPharmacyBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;
        const { status, userId, pharmacyId, orderType, isRapid } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (pharmacyId) query.pharmacyId = pharmacyId;
        if (orderType) query.orderType = orderType;
        if (isRapid !== undefined) query.isRapid = isRapid === 'true';

        const total = await PharmacyBooking.countDocuments(query);
        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('pharmacyId', 'name city phone profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            orderType: order.orderType || 'General',
            status: order.status,
            deliveryStatus: order.deliveryStatus,
            isRapid: Boolean(order.isRapid),
            customer: {
                id: order.userId?._id || null,
                name: order.userId?.name || order.address?.name || "Customer",
                phone: order.userId?.phone || order.address?.phone || ""
            },
            pharmacy: {
                id: order.pharmacyId?._id || null,
                name: order.pharmacyId?.name || "Pharmacy Store",
                city: order.pharmacyId?.city || "",
                phone: order.pharmacyId?.phone || ""
            },
            collectionType: order.collectionType,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalAmount: order.billSummary?.totalAmount || 0,
            itemsCount: order.items?.length || 0,
            itemsSummary: (order.items || []).map(item => ({
                name: item.name,
                quantity: item.quantity
            })),
            createdAt: order.createdAt,
            formattedDate: moment(order.createdAt).format('DD MMM YYYY, hh:mm A')
        }));

        res.json({
            success: true,
            total,
            count: formattedOrders.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: formattedOrders
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 7. ADMIN: TOGGLE ACTIVE / INACTIVE PHARMACY
// Endpoint: PATCH /admin/pharmacy/status/active-inactive/:pharmacyId
// =========================================================================
const toggleActiveInactivePharmacy = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const pharmacy = await Pharmacy.findById(pharmacyId);
 
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy not found." });
        }
 
        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
            pharmacyId,
            { $set: { isActive: !pharmacy.isActive } },
            { new: true }
        );
 
        return res.json({
            success: true,
            message: `Pharmacy status updated to ${updatedPharmacy.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                pharmacyId: updatedPharmacy._id,
                isActive: updatedPharmacy.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};

// 🌟 Sabhi 7 functions ka export
module.exports = { 
    adminGetApprovedPharmacies, 
    adminGetPharmacyVendorsForOrders,
    adminGetOrdersByPharmacyId,
    adminGetPharmacyBookingDetails,
    adminGetCancelledPharmacyOrders,
    adminGetPharmacyBookings, 
    toggleActiveInactivePharmacy 
};