// controllers/ambulance/ambulanceStaffController.js
const Ambulance = require('../../models/Ambulance');
const mongoose = require('mongoose');

// ==========================================
// 1. GET AMBULANCE SUPPORT STAFF LIST
// Endpoint: GET /api/ambulance/staff/:ambulanceId
// ==========================================
const getAmbulanceStaff = async (req, res) => {
    try {
        const { ambulanceId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(ambulanceId)) {
            return res.status(400).json({ success: false, message: "Invalid Ambulance ID format." });
        }

        const ambulance = await Ambulance.findById(ambulanceId)
            .select('name vehicleNumber role clinicId supportStaff')
            .lean();

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        res.json({
            success: true,
            ambulanceId: ambulance._id,
            vehicleNumber: ambulance.vehicleNumber,
            role: ambulance.role,
            supportStaff: ambulance.supportStaff || []
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. UPDATE / ASSIGN SUPPORT STAFF (Admin, Clinic, or Ambulance)
// Endpoint: PUT /api/ambulance/staff/:ambulanceId
// ==========================================
const updateAmbulanceStaff = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const { supportStaff } = req.body;
        const userRole = req.user.role; // 'admin', 'superadmin', 'clinic', 'ambulance', 'clinic-ambulance'
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(ambulanceId)) {
            return res.status(400).json({ success: false, message: "Invalid Ambulance ID format." });
        }

        if (!supportStaff || !Array.isArray(supportStaff)) {
            return res.status(400).json({ success: false, message: "supportStaff must be an array." });
        }

        const ambulance = await Ambulance.findById(ambulanceId);
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

            // 🛡️ STRICT PERMISSION LOGIC:
            const isAdmin = ['admin', 'superadmin'].includes(userRole);
            const isClinicOwner = userRole === 'clinic' && ambulance.clinicId?.toString() === userId.toString();
            const isIndependentAmbulance = userRole === 'ambulance' && ambulance._id.toString() === userId.toString();
    
            if (!isAdmin && !isClinicOwner && !isIndependentAmbulance) {
                return res.status(403).json({
                    success: false,
                    message: "Access Denied: Only Clinic owner, Independent Ambulance partner, or Admin can modify support staff."
                });
            }
    

        // 🎯 DIRECT ARRAY MAPPING:
        ambulance.supportStaff = supportStaff.map(staff => ({
            facilityId: staff.facilityId || null,
            name: staff.name.trim(),
            available: staff.available === true || staff.available === 'true',
            price: Number(staff.price) || 0
        }));

        await ambulance.save();

        res.json({
            success: true,
            message: `Supporting staff updated successfully for Ambulance '${ambulance.vehicleNumber}'.`,
            ambulanceId: ambulance._id,
            vehicleNumber: ambulance.vehicleNumber,
            supportStaff: ambulance.supportStaff
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. REMOVE / DELETE SINGLE STAFF ITEM FROM AMBULANCE
// Endpoint: DELETE /api/ambulance/staff/:ambulanceId/:staffId
// ==========================================
const deleteAmbulanceStaff = async (req, res) => {
    try {
        const { ambulanceId, staffId } = req.params;
        const userRole = req.user.role;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(ambulanceId) || !mongoose.Types.ObjectId.isValid(staffId)) {
            return res.status(400).json({ success: false, message: "Invalid Ambulance ID or Staff ID format." });
        }

        const ambulance = await Ambulance.findById(ambulanceId);
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        // 🛡️ PERMISSION CHECK:
        const isAdmin = ['admin', 'superadmin'].includes(userRole);
        const isClinicOwner = userRole === 'clinic' && ambulance.clinicId?.toString() === userId.toString();
        const isIndependentAmbulance = userRole === 'ambulance' && ambulance._id.toString() === userId.toString();

        if (!isAdmin && !isClinicOwner && !isIndependentAmbulance) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: You do not have permission to delete staff from this ambulance."
            });
        }

        // 🎯 Remove the specific item from supportStaff array
        const updatedAmbulance = await Ambulance.findByIdAndUpdate(
            ambulanceId,
            {
                $pull: {
                    supportStaff: {
                        $or: [
                            { _id: staffId },
                            { facilityId: staffId }
                        ]
                    }
                }
            },
            { new: true }
        );

        res.json({
            success: true,
            message: "Supporting staff item removed successfully from ambulance.",
            ambulanceId: updatedAmbulance._id,
            supportStaff: updatedAmbulance.supportStaff
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getAmbulanceStaff,
    updateAmbulanceStaff,
    deleteAmbulanceStaff
};