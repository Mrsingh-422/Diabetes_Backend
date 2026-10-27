const PharmacyBooking = require('../../../models/PharmacyBooking');
const Pharmacy = require('../../../models/Pharmacy');
const mongoose = require('mongoose');
const moment = require('moment');

// --- 1. ADMIN: GET APPROVED PHARMACIES LIST (Limit: 25) ---
// Endpoint: GET /admin/pharmacy/approved-list?page=1
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
// 🌟 2. ADMIN: GET PHARMACY BOOKINGS (Lightweight Important Summary Only)
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

        // 🌟 Only Essential Info for Admin Dashboard Table
        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            orderType: order.orderType || 'General',
            status: order.status,
            deliveryStatus: order.deliveryStatus,
            isRapid: Boolean(order.isRapid),
            
            // Customer Important Info
            customer: {
                id: order.userId?._id || null,
                name: order.userId?.name || order.address?.name || "Customer",
                phone: order.userId?.phone || order.address?.phone || ""
            },

            // Vendor (Pharmacy) Important Info
            pharmacy: {
                id: order.pharmacyId?._id || null,
                name: order.pharmacyId?.name || "Pharmacy Store",
                city: order.pharmacyId?.city || "",
                phone: order.pharmacyId?.phone || ""
            },

            // Delivery & Payment Mode
            collectionType: order.collectionType,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalAmount: order.billSummary?.totalAmount || 0,

            // Quick Items Summary
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
// 🌟 3. NEW: ADMIN GET COMPLETE ORDER DETAILS (Full Medicine, Vendor, User & Bill)
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

                // 👤 1. USER / CUSTOMER DETAILS
                customer: order.userId ? {
                    id: order.userId._id,
                    name: order.userId.name,
                    phone: order.userId.phone,
                    email: order.userId.email,
                    gender: order.userId.gender,
                    age: order.userId.age || null
                } : null,
                deliveryAddress: order.address,

                // 🏥 2. VENDOR (PHARMACY) DETAILS
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

                // 💊 3. MEDICINE DETAILS (Complete Itemized List)
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

                // 💰 4. BILL SUMMARY (Full Financial Breakdown)
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

                // Payment Info
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                paymentDetails: order.paymentDetails,

                // Delivery Partner & Files
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

// --- 4. ADMIN: TOGGLE ACTIVE / INACTIVE PHARMACY ---
// Endpoint: PATCH /admin/pharmacy/status/active-inactive/:pharmacyId
const toggleActiveInactivePharmacy = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const pharmacy = await Pharmacy.findById(pharmacyId);
 
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "pharmacy not found." });
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
 
module.exports = { 
    adminGetApprovedPharmacies, 
    adminGetPharmacyBookings, 
    adminGetPharmacyBookingDetails, 
    toggleActiveInactivePharmacy 
};