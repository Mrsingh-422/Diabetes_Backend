// controllers/clinic/clinicWardBedController.js
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const moment = require('moment');

// Helper: Short prefix generator (e.g., "Daycare Ward" -> "DW", "Observation" -> "O")
const getShortName = (name) => {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase();
};

// ==========================================
// 1. CREATE WARD UNIT & AUTO-GENERATE BEDS
// Endpoint: POST /api/clinic/wards/create
// ==========================================
const createClinicWardUnit = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { name, type = 'Daycare', totalBeds, pricePerDay = 500 } = req.body;

        if (!name || !totalBeds || Number(totalBeds) < 1) {
            return res.status(400).json({
                success: false,
                message: "Ward name and valid totalBeds count are required."
            });
        }

        const count = Number(totalBeds);
        const price = Number(pricePerDay);

        // 1. Create Ward document
        const ward = await Ward.create({
            clinicId,
            name,
            type, // 'General', 'Daycare', 'Observation', 'ICU', 'Private Room', 'Semi-Private'
            totalBeds: count,
            availableBeds: count,
            pricePerDay: price
        });

        // 2. Auto-generate individual Bed units (e.g. DW-01, DW-02)
        const shortName = getShortName(name);
        const bedData = [];
        for (let i = 1; i <= count; i++) {
            bedData.push({
                clinicId,
                wardId: ward._id,
                bedNumber: `${shortName}-${i.toString().padStart(2, '0')}`,
                status: 'Available',
                pricePerDay: price
            });
        }

        const beds = await Bed.insertMany(bedData);

        res.status(201).json({
            success: true,
            message: `Ward '${name}' created with ${count} beds generated successfully.`,
            data: {
                ward,
                bedsGeneratedCount: beds.length
            }
        });

    } catch (error) {
        console.error("Create Clinic Ward Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🏥 1. GET CLINIC WARDS (With Real-Time Available/Occupied Beds Count)
// ==========================================
const getClinicWards = async (req, res) => {
    try {
        const clinicId = req.params.clinicId || req.user.id;
        const { date } = req.query;

        const checkDate = date ? new Date(date) : new Date();

        // 1. Fetch all wards for this clinic
        const wards = await Ward.find({ clinicId }).lean();

        // 2. Fetch all active/confirmed bed appointments for this clinic on this date
        const activeBookings = await Appointment.find({
            clinicId,
            bookingType: { $in: ['Admission', 'Emergency', 'IPD', 'EMERGENCY'] },
            status: { $in: ['Confirmed', 'In-Progress', 'Admitted', 'Pending'] },
            startDate: { $lte: checkDate },
            endDate: { $gte: checkDate }
        }).select('bedId bedNumber wardName').lean();

        const bookedBedIds = new Set(activeBookings.map(b => b.bedId?.toString()).filter(Boolean));
        const bookedBedNumbers = new Set(activeBookings.map(b => b.bedNumber).filter(Boolean));

        // 3. Dynamically calculate available vs occupied count
        const updatedWards = wards.map(ward => {
            const totalBeds = Array.isArray(ward.beds) ? ward.beds.length : (ward.totalBeds || 0);
            
            let occupiedCount = 0;
            if (Array.isArray(ward.beds)) {
                occupiedCount = ward.beds.filter(bed => {
                    const isIdBooked = bed._id && bookedBedIds.has(bed._id.toString());
                    const isNumBooked = bed.bedNumber && bookedBedNumbers.has(bed.bedNumber);
                    const isManuallyOccupied = bed.status === 'Occupied' || bed.status === 'Reserved' || bed.isOccupied === true;
                    return isIdBooked || isNumBooked || isManuallyOccupied;
                }).length;
            }

            const availableBedsCount = Math.max(0, totalBeds - occupiedCount);

            return {
                ...ward,
                totalBeds,
                availableBeds: availableBedsCount,
                occupiedBeds: occupiedCount,
                availabilityText: `${availableBedsCount} of ${totalBeds} Free` // 👈 Frontend Badge (e.g. 7 of 8 Free)
            };
        });

        res.json({
            success: true,
            count: updatedWards.length,
            data: updatedWards
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 🛏️ 2. GET BEDS IN CLINIC WARD (With Real-Time Reserved/Occupied Flags)
// ==========================================
const getBedsInClinicWard = async (req, res) => {
    try {
        const { wardId } = req.params;
        const { startDate, endDate } = req.query;

        const ward = await Ward.findById(wardId).lean();
        if (!ward) {
            return res.status(404).json({ success: false, message: "Ward not found." });
        }

        // Admission Date Range Check
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date(start);

        // 🚨 Check conflicting active appointments in database
        const activeAppointments = await Appointment.find({
            wardId,
            status: { $in: ['Confirmed', 'In-Progress', 'Admitted', 'Pending'] },
            $or: [
                { startDate: { $lte: end }, endDate: { $gte: start } } // Overlapping stay dates
            ]
        }).select('bedId bedNumber bookingId status').lean();

        const occupiedBedIds = new Set(activeAppointments.map(a => a.bedId?.toString()).filter(Boolean));
        const occupiedBedNumbers = new Set(activeAppointments.map(a => a.bedNumber).filter(Boolean));

        // 🛡️ Map each bed with real-time status
        const bedsList = (ward.beds || []).map(bed => {
            const isBookedById = bed._id && occupiedBedIds.has(bed._id.toString());
            const isBookedByNum = bed.bedNumber && occupiedBedNumbers.has(bed.bedNumber);
            const isManuallyOccupied = bed.status === 'Occupied' || bed.status === 'Reserved' || bed.isOccupied === true;

            const isOccupied = isBookedById || isBookedByNum || isManuallyOccupied;

            return {
                _id: bed._id,
                bedId: bed._id,
                bedNumber: bed.bedNumber,
                dailyCharge: bed.dailyCharge || ward.pricePerDay || 600,
                status: isOccupied ? 'Occupied' : 'Available',  // 👈 Frontend matches: 'Occupied' (Grey) / 'Available' (Green)
                isAvailable: !isOccupied,
                isOccupied: isOccupied
            };
        });

        res.json({
            success: true,
            wardId: ward._id,
            wardName: ward.wardName,
            wardType: ward.wardType,
            pricePerDay: ward.pricePerDay || 600,
            availableBedsCount: bedsList.filter(b => b.isAvailable).length,
            totalBedsCount: bedsList.length,
            beds: bedsList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UPDATE WARD DETAILS (Name, Type, Active Status)
// Endpoint: PUT /api/clinic/wards/update/:wardId
// ==========================================
const updateClinicWardInfo = async (req, res) => {
    try {
        const { wardId } = req.params;
        const clinicId = req.user.id;
        const { name, type, isActive, pricePerDay } = req.body;

        const updatePayload = {};
        if (name) updatePayload.name = name;
        if (type) updatePayload.type = type;
        if (typeof isActive !== 'undefined') updatePayload.isActive = isActive;
        if (pricePerDay !== undefined) updatePayload.pricePerDay = Number(pricePerDay);

        const ward = await Ward.findOneAndUpdate(
            { _id: wardId, clinicId },
            { $set: updatePayload },
            { new: true }
        );

        if (!ward) {
            return res.status(404).json({ success: false, message: "Ward not found or unauthorized." });
        }

        res.json({
            success: true,
            message: "Ward information updated successfully.",
            data: ward
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. BULK ADD / REMOVE BEDS IN A WARD
// Endpoint: PUT /api/clinic/wards/update-beds
// ==========================================
const updateClinicWardBeds = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { wardId, action, bedCount, pricePerDay } = req.body;

        const ward = await Ward.findOne({ _id: wardId, clinicId });
        if (!ward) {
            return res.status(404).json({ success: false, message: "Ward not found." });
        }

        const count = Number(bedCount);
        if (!count || count <= 0) {
            return res.status(400).json({ success: false, message: "Valid bedCount is required." });
        }

        if (action === 'add') {
            const currentTotal = ward.totalBeds;
            const shortName = getShortName(ward.name);
            const bedPrice = pricePerDay ? Number(pricePerDay) : (ward.pricePerDay || 500);
            const bedData = [];

            for (let i = 1; i <= count; i++) {
                bedData.push({
                    clinicId,
                    wardId: ward._id,
                    bedNumber: `${shortName}-${(currentTotal + i).toString().padStart(2, '0')}`,
                    status: 'Available',
                    pricePerDay: bedPrice
                });
            }

            await Bed.insertMany(bedData);
            ward.totalBeds += count;
            ward.availableBeds += count;

        } else if (action === 'remove') {
            // Only remove available beds (LIFO order)
            const removableBeds = await Bed.find({ wardId, clinicId, status: 'Available' })
                .sort({ createdAt: -1 })
                .limit(count);

            if (removableBeds.length < count) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot remove ${count} beds. Only ${removableBeds.length} available (unoccupied) beds found.`
                });
            }

            const idsToRemove = removableBeds.map(b => b._id);
            await Bed.deleteMany({ _id: { $in: idsToRemove } });

            ward.totalBeds -= count;
            ward.availableBeds -= count;
        } else {
            return res.status(400).json({ success: false, message: "Invalid action. Expected 'add' or 'remove'." });
        }

        await ward.save();

        res.json({
            success: true,
            message: `Successfully ${action === 'add' ? 'added' : 'removed'} ${count} beds in ward '${ward.name}'.`,
            data: ward
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. DELETE SPECIFIC EMPTY BED
// Endpoint: DELETE /api/clinic/wards/bed/:bedId
// ==========================================
const deleteSpecificClinicBed = async (req, res) => {
    try {
        const { bedId } = req.params;
        const clinicId = req.user.id;

        const bed = await Bed.findOne({ _id: bedId, clinicId });
        if (!bed) {
            return res.status(404).json({ success: false, message: "Bed not found." });
        }

        // Occupied bed cannot be deleted
        if (bed.status !== 'Available') {
            return res.status(400).json({
                success: false,
                message: "Cannot delete an occupied or maintenance bed."
            });
        }

        const wardId = bed.wardId;
        await Bed.findByIdAndDelete(bedId);

        // Sync Ward capacity counts
        await Ward.findOneAndUpdate(
            { _id: wardId, clinicId },
            { $inc: { totalBeds: -1, availableBeds: -1 } }
        );

        res.json({
            success: true,
            message: "Bed unit removed and ward capacity synchronized."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 7. DELETE ENTIRE WARD (If no beds occupied)
// Endpoint: DELETE /api/clinic/wards/delete/:wardId
// ==========================================
const deleteClinicWard = async (req, res) => {
    try {
        const { wardId } = req.params;
        const clinicId = req.user.id;

        // Check if any bed in this ward is occupied or in maintenance
        const occupiedBed = await Bed.findOne({
            wardId,
            clinicId,
            status: { $ne: 'Available' }
        });

        if (occupiedBed) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete ward while beds are occupied or reserved."
            });
        }

        // Delete all child beds first, then delete ward
        await Bed.deleteMany({ wardId, clinicId });
        await Ward.findOneAndDelete({ _id: wardId, clinicId });

        res.json({
            success: true,
            message: "Ward and its associated bed units deleted successfully."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 8. UPDATE INDIVIDUAL BED STATUS (Maintenance / Available)
// Endpoint: PATCH /api/clinic/wards/bed/status
// ==========================================
const updateClinicBedStatus = async (req, res) => {
    try {
        const { bedId, status } = req.body; // 'Available' | 'Maintenance' | 'Reserved'
        const clinicId = req.user.id;

        const bed = await Bed.findOne({ _id: bedId, clinicId });
        if (!bed) {
            return res.status(404).json({ success: false, message: "Bed unit not found." });
        }

        const oldStatus = bed.status;
        bed.status = status;
        await bed.save();

        // Sync Ward available beds counter
        if (oldStatus !== 'Available' && status === 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
        } else if (oldStatus === 'Available' && status !== 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });
        }

        res.json({
            success: true,
            message: `Bed ${bed.bedNumber} status updated to ${status}.`,
            data: bed
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 9. ADMIT PATIENT TO BED (Daycare / Admission Desk)
// Endpoint: POST /api/clinic/wards/admit-patient
// ==========================================
const admitPatientToClinicBed = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { appointmentId, bedId, startDate, endDate } = req.body;

        // 1. Fetch Target Bed
        const bed = await Bed.findOne({ _id: bedId, clinicId });
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected Bed unit not found." });
        }

        if (bed.status === 'Maintenance') {
            return res.status(400).json({ success: false, message: "Selected bed is currently under maintenance." });
        }

        // 2. Fetch Target Appointment
        const appointment = await Appointment.findOne({ _id: appointmentId, clinicId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Patient appointment record not found." });
        }

        const start = startDate ? moment(startDate).startOf('day').toDate() : (appointment.startDate || moment().startOf('day').toDate());
        const end = endDate ? moment(endDate).endOf('day').toDate() : (appointment.endDate || moment().add(1, 'days').endOf('day').toDate());

        // 3. Strict Overlap / Double-Booking Check
        const isAlreadyBooked = await Appointment.findOne({
            _id: { $ne: appointmentId },
            clinicId,
            bedId: bedId,
            status: { $in: ['Confirmed', 'In-Progress', 'Clinic-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        });

        if (isAlreadyBooked) {
            return res.status(400).json({
                success: false,
                message: "Selected bed is already occupied during requested dates. Please pick another bed."
            });
        }

        // 4. Update Bed physical status to Occupied
        bed.status = 'Occupied';
        bed.currentAppointmentId = appointment._id;
        await bed.save();

        // 5. Update Ward available count
        const ward = await Ward.findById(bed.wardId);
        if (ward && ward.availableBeds > 0) {
            ward.availableBeds -= 1;
            await ward.save();
        }

        // 6. Update Appointment details
        appointment.bedId = bedId;
        appointment.bedNumber = bed.bedNumber;
        appointment.wardName = ward ? ward.name : appointment.wardName;
        appointment.startDate = start;
        appointment.endDate = end;
        appointment.bookingType = 'Admission';
        appointment.status = 'In-Progress'; // Physical check-in

        await appointment.save();

        res.json({
            success: true,
            message: `Patient successfully admitted to ${ward ? ward.name : 'Ward'} - Bed ${bed.bedNumber}.`,
            data: appointment
        });

    } catch (error) {
        console.error("Admit Patient to Clinic Bed Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 10. ASSIGN DOCTOR TO ADMISSION / APPOINTMENT
// Endpoint: POST /api/clinic/wards/assign-doctor
// ==========================================
const assignDoctorToClinicAdmission = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { appointmentId, doctorId } = req.body;

        const doctor = await Doctor.findOne({ _id: doctorId, clinicId });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Selected doctor not found in your clinic directory." });
        }

        const appointment = await Appointment.findOne({ _id: appointmentId, clinicId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        appointment.doctorId = doctorId;
        appointment.status = 'Confirmed';
        await appointment.save();

        res.json({
            success: true,
            message: `Dr. ${doctor.name} assigned & admission/appointment confirmed.`,
            data: appointment
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 11. GET ALL CLINIC ADMISSIONS / DAYCARE PATIENTS
// Endpoint: GET /api/clinic/wards/admissions/all
// ==========================================
const getAllClinicAdmissions = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { status, bedBookingType } = req.query;

        let query = {
            clinicId,
            bookingType: { $in: ['Admission', 'Daycare'] }
        };

        if (status) query.status = status;
        if (bedBookingType) query.bedBookingType = bedBookingType;

        const admissions = await Appointment.find(query)
            .populate('userId', 'name phone profilePic age gender')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: admissions.length,
            data: admissions
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createClinicWardUnit,
    getClinicWards,
    getBedsInClinicWard,
    updateClinicWardInfo,
    updateClinicWardBeds,
    deleteSpecificClinicBed,
    deleteClinicWard,
    updateClinicBedStatus,
    admitPatientToClinicBed,
    assignDoctorToClinicAdmission,
    getAllClinicAdmissions
};