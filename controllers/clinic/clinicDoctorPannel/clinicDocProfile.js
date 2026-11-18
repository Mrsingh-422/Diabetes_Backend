// controllers/clinic/clinicDoctorPannel/clinicDocProfile.js

const Doctor = require('../../../models/Doctor');
const Clinic = require('../../../models/Clinic');
const Appointment = require('../../../models/Appointment');
const Admin = require('../../../models/Admin');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const mongoose = require('mongoose');
const moment = require('moment');
const { deleteFile } = require('../../../utils/fileHandler');
const { sendPushNotification } = require('../../../utils/notification');

// ==========================================
// 1. GET MY CLINIC DOCTOR PROFILE
// @route   GET /api/clinic/doctor-panel/profile
// @access  Private (Clinic Doctor)
// ==========================================
const getMyDoctorProfile = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id)
            .populate('clinicId', 'name clinicName email phoneNumber address city state image posterimage isActive')
            .select('-password -token')
            .lean();

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor profile not found."
            });
        }

        return res.status(200).json({
            success: true,
            data: doctor
        });
    } catch (error) {
        console.error("Get Clinic Doctor Profile Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 2. UPDATE MY CLINIC DOCTOR PROFILE (Staged for Admin Approval + Disk Cleanup)
// @route   PUT /api/clinic/doctor-panel/profile/update
// @access  Private (Clinic Doctor)
// ==========================================
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id;

        const existingDoc = await Doctor.findById(doctorId);
        if (!existingDoc) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found"
            });
        }

        const {
            name,
            gender,
            country,
            state,
            city,
            pincode,
            address,
            qualification,
            speciality,
            about,
            experienceYears,
            languages,
            treatedConditions,
            competencies,
            fees,
            consultationStatus,
            alternatePhone,

            // Flat fields to bypass WAF blocks
            fees_online,
            fees_clinic,
            fees_home,
            consultationStatus_online,
            consultationStatus_clinic,
            consultationStatus_home
        } = req.body || {};

        const updates = {};
        if (name) updates.name = name;
        if (gender) updates.gender = gender;
        if (country) updates.country = country;
        if (state) updates.state = state;
        if (city) updates.city = city;
        if (pincode) updates.pincode = pincode;
        if (address) updates.address = address;
        if (qualification) updates.qualification = qualification;
        if (speciality) updates.speciality = speciality;
        if (about !== undefined) updates.about = about;
        if (experienceYears !== undefined) updates.experienceYears = Number(experienceYears);
        if (alternatePhone !== undefined) updates.alternatePhone = alternatePhone;

        const safeArrayParse = (val) => {
            if (Array.isArray(val)) return val;
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    return Array.isArray(parsed) ? parsed : [val];
                } catch (e) {
                    return val.split(',').map((s) => s.trim()).filter(Boolean);
                }
            }
            return [];
        };

        if (languages !== undefined) updates.languages = safeArrayParse(languages);
        if (treatedConditions !== undefined) updates.treatedConditions = safeArrayParse(treatedConditions);
        if (competencies !== undefined) updates.competencies = safeArrayParse(competencies);

        // Assemble fees object
        if (fees_online !== undefined || fees_clinic !== undefined || fees_home !== undefined) {
            updates.fees = {
                online: fees_online !== undefined ? Number(fees_online) : (existingDoc.fees?.online || 0),
                clinic: fees_clinic !== undefined ? Number(fees_clinic) : (existingDoc.fees?.clinic || 0),
                home: fees_home !== undefined ? Number(fees_home) : (existingDoc.fees?.home || 0)
            };
        } else if (fees) {
            updates.fees = typeof fees === 'string' ? JSON.parse(fees) : fees;
        }

        // Assemble consultationStatus & direct availability booleans
        if (
            consultationStatus_online !== undefined ||
            consultationStatus_clinic !== undefined ||
            consultationStatus_home !== undefined
        ) {
            const onlineVal = consultationStatus_online !== undefined
                ? (consultationStatus_online === 'true' || consultationStatus_online === true)
                : (existingDoc.consultationStatus?.online ?? true);
            const clinicVal = consultationStatus_clinic !== undefined
                ? (consultationStatus_clinic === 'true' || consultationStatus_clinic === true)
                : (existingDoc.consultationStatus?.clinic ?? true);
            const homeVal = consultationStatus_home !== undefined
                ? (consultationStatus_home === 'true' || consultationStatus_home === true)
                : (existingDoc.consultationStatus?.home ?? false);

            updates.consultationStatus = {
                online: onlineVal,
                clinic: clinicVal,
                home: homeVal
            };
            updates.isOnlineAvailable = onlineVal;
            updates.isClinicAvailable = clinicVal;
            updates.isHomeAvailable = homeVal;
        } else if (consultationStatus) {
            const parsedStatus = typeof consultationStatus === 'string'
                ? JSON.parse(consultationStatus)
                : consultationStatus;
            updates.consultationStatus = parsedStatus;
            if (parsedStatus.online !== undefined) updates.isOnlineAvailable = Boolean(parsedStatus.online);
            if (parsedStatus.clinic !== undefined) updates.isClinicAvailable = Boolean(parsedStatus.clinic);
            if (parsedStatus.home !== undefined) updates.isHomeAvailable = Boolean(parsedStatus.home);
        }

        // Process uploaded files (profileImage & signatureImage)
        if (req.files) {
            if (req.files.profileImage && req.files.profileImage[0]) {
                updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
            }
            const sigFile = req.files.signatureImage?.[0] || req.files.signature?.[0];
            if (sigFile) {
                updates.signatureImage = `/uploads/doctors/${sigFile.filename}`;
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide at least one field or image to update."
            });
        }

        // Disk Cleanup: Remove unapproved files from any existing Pending update request
        const existingPending = await ProfileUpdateRequest.findOne({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            status: 'Pending'
        });

        if (existingPending) {
            if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            if (updates.signatureImage && existingPending.updatedFields?.signatureImage) {
                deleteFile(existingPending.updatedFields.signatureImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        // Save staged changes for Admin Approval
        const request = await ProfileUpdateRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            updatedFields: updates,
            status: 'Pending'
        });

        // Notify active Admins (Non-blocking)
        try {
            const admins = await Admin.find({ isActive: true }).select('_id').lean();
            await Promise.allSettled(
                admins.map((adm) =>
                    sendPushNotification(
                        adm._id,
                        'admin',
                        "Clinic Doctor Profile Update Request",
                        `${existingDoc.name} submitted profile changes for approval.`,
                        {
                            doctorId: String(doctorId),
                            requestId: String(request._id),
                            type: "CLINIC_DOCTOR_PROFILE_UPDATE"
                        }
                    )
                )
            );
        } catch (notifErr) {
            console.error("Admin Notification Error:", notifErr.message);
        }

        return res.status(200).json({
            success: true,
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.",
            data: request
        });
    } catch (error) {
        console.error("Update Clinic Doctor Profile Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 3. GET LATEST PROFILE UPDATE REQUEST STATUS
// @route   GET /api/clinic/doctor-panel/profile/update-status
// @access  Private (Clinic Doctor)
// ==========================================
const getLatestDoctorProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Doctor'
        })
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            hasPendingRequest: latestRequest?.status === 'Pending',
            data: latestRequest || null
        });
    } catch (error) {
        console.error("Get Latest Doctor Profile Request Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 4. APPLY FOR DOCTOR LEAVE (Future Dates Only: Tomorrow Onwards)
// @route   POST /api/clinic/doctor-panel/leaves/apply
// @access  Private (Clinic Doctor)
// ==========================================
const applyDoctorLeave = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { startDate, endDate, reason } = req.body || {};

        if (!startDate || !endDate || !reason || String(reason).trim() === "") {
            return res.status(400).json({
                success: false,
                message: "startDate, endDate, and explanation reason are mandatory."
            });
        }

        const todayStart = moment().startOf('day');
        const reqStart = moment(startDate).startOf('day');
        const reqEnd = moment(endDate).endOf('day');

        if (!reqStart.isValid() || !reqEnd.isValid()) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format. Please use YYYY-MM-DD."
            });
        }

        // Strict Rule: Today and past dates leave cannot be applied
        if (reqStart.isSameOrBefore(todayStart)) {
            return res.status(400).json({
                success: false,
                message: "Restricted: You cannot apply leave for today or past dates. Leaves are allowed only for tomorrow onwards. For today's absence, please update your duty status or block your OPD slots."
            });
        }

        if (reqEnd.isBefore(reqStart)) {
            return res.status(400).json({
                success: false,
                message: "End date must be on or after start date."
            });
        }

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor profile not found."
            });
        }

        // Check overlapping Pending or Approved leaves
        const isOverlapping = (doctor.leaves || []).some((l) => {
            if (l.status === 'Rejected') return false;
            const lStart = moment(l.startDate).startOf('day');
            const lEnd = moment(l.endDate).endOf('day');
            return reqStart.isSameOrBefore(lEnd) && reqEnd.isSameOrAfter(lStart);
        });

        if (isOverlapping) {
            return res.status(400).json({
                success: false,
                message: "You already have a Pending or Approved leave overlapping with these dates."
            });
        }

        const newLeave = {
            startDate: reqStart.toDate(),
            endDate: reqEnd.toDate(),
            reason: String(reason).trim(),
            status: 'Pending',
            appliedAt: new Date()
        };

        if (!Array.isArray(doctor.leaves)) doctor.leaves = [];
        doctor.leaves.push(newLeave);
        await doctor.save();

        // Notify Admins (Non-blocking)
        try {
            const admins = await Admin.find({ isActive: true }).select('_id').lean();
            await Promise.allSettled(
                admins.map((adm) =>
                    sendPushNotification(
                        adm._id,
                        'admin',
                        "New Clinic Doctor Leave Request",
                        `${doctor.name} applied for leave from ${reqStart.format('DD MMM')} to ${reqEnd.format('DD MMM')}. Reason: "${String(reason).trim()}".`,
                        {
                            doctorId: doctor._id.toString(),
                            clinicId: doctor.clinicId ? doctor.clinicId.toString() : "",
                            type: 'clinic_doctor_leave_request'
                        }
                    )
                )
            );
        } catch (e) {}

        return res.status(201).json({
            success: true,
            message: "Leave application submitted successfully for approval.",
            data: doctor.leaves[doctor.leaves.length - 1]
        });
    } catch (error) {
        console.error("Apply Clinic Doctor Leave Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 5. GET MY LEAVE APPLICATIONS HISTORY
// @route   GET /api/clinic/doctor-panel/leaves
// @access  Private (Clinic Doctor)
// ==========================================
const getDoctorLeavesHistory = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id)
            .select('name leaves')
            .lean();

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found."
            });
        }

        const leaves = (doctor.leaves || []).sort(
            (a, b) => new Date(b.appliedAt) - new Date(a.appliedAt)
        );

        return res.status(200).json({
            success: true,
            count: leaves.length,
            data: leaves
        });
    } catch (error) {
        console.error("Get Clinic Doctor Leaves Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 6. CHECK IF DOCTOR IS BUSY OR FREE (Live Status + Active Consultations)
// @route   GET /api/clinic/doctor-panel/busy-status (Doctor checks self)
// @route   GET /api/clinic/doctor-panel/busy-status/:doctorId (Clinic checks specific doctor)
// @access  Private (Clinic Doctor or Clinic)
// ==========================================
const checkDoctorBusyStatus = async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        let targetDoctorId = req.user.id;
        let clinicFilter = {};

        // If Clinic is checking a specific doctor's busy status
        if (userRole === 'clinic') {
            targetDoctorId = req.params.doctorId || req.query.doctorId;
            if (!targetDoctorId || !mongoose.Types.ObjectId.isValid(targetDoctorId)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid doctorId is required."
                });
            }
            clinicFilter = { clinicId: req.user.id };
        }

        const doctor = await Doctor.findOne({ _id: targetDoctorId, ...clinicFilter })
            .select('name speciality profileImage dutyStatus isActive isOnline profileStatus leaves clinicId')
            .lean();

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found."
            });
        }

        // Check active In-Progress appointments right now
        const activeInProgressAppointments = await Appointment.find({
            doctorId: doctor._id,
            status: 'In-Progress'
        })
            .select('_id bookingId bookingType consultationType appointmentDate appointmentTime wardName bedNumber patients')
            .lean();

        // Check if doctor is on Approved Leave today
        const todayStart = moment().startOf('day');
        const todayEnd = moment().endOf('day');
        const isOnApprovedLeaveToday = (doctor.leaves || []).some((l) => {
            if (l.status !== 'Approved') return false;
            return moment(l.startDate).isSameOrBefore(todayEnd) && moment(l.endDate).isSameOrAfter(todayStart);
        });

        const currentDutyStatus = doctor.dutyStatus || 'On Duty';
        const hasActiveInProgressCase = activeInProgressAppointments.length > 0;

        // Busy logic: true if manually marked Busy OR currently in an In-Progress appointment
        const isBusy = currentDutyStatus === 'Busy' || hasActiveInProgressCase;

        // Available for new assignment logic
        const isAvailable =
            doctor.isActive !== false &&
            doctor.profileStatus === 'Approved' &&
            !['Busy', 'Off Duty', 'On Leave'].includes(currentDutyStatus) &&
            !isOnApprovedLeaveToday &&
            !hasActiveInProgressCase;

        let statusSummary = "Free (On Duty)";
        if (doctor.isActive === false) statusSummary = "Account Inactive";
        else if (doctor.profileStatus !== 'Approved') statusSummary = `Profile ${doctor.profileStatus}`;
        else if (isOnApprovedLeaveToday || currentDutyStatus === 'On Leave') statusSummary = "On Leave";
        else if (currentDutyStatus === 'Off Duty') statusSummary = "Off Duty";
        else if (currentDutyStatus === 'Busy' && hasActiveInProgressCase) statusSummary = "Busy (Marked Busy & In Consultation)";
        else if (currentDutyStatus === 'Busy') statusSummary = "Busy (Marked Busy by Doctor)";
        else if (hasActiveInProgressCase) statusSummary = "Busy (Currently In-Progress Consultation)";

        return res.status(200).json({
            success: true,
            data: {
                doctorId: doctor._id,
                name: doctor.name,
                speciality: doctor.speciality,
                profileImage: doctor.profileImage,
                dutyStatus: currentDutyStatus,
                isBusy,
                isFree: !isBusy && isAvailable,
                isAvailable,
                isOnApprovedLeaveToday,
                hasActiveInProgressCase,
                activeInProgressCount: activeInProgressAppointments.length,
                activeInProgressAppointments: activeInProgressAppointments.map((a) => ({
                    _id: a._id,
                    bookingId: a.bookingId,
                    bookingType: a.bookingType,
                    consultationType: a.consultationType,
                    patientName: a.patients?.[0]?.patientName || "Patient",
                    wardName: a.wardName || null,
                    bedNumber: a.bedNumber || null
                })),
                statusSummary
            }
        });
    } catch (error) {
        console.error("Check Doctor Busy Status Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 7. UPDATE / TOGGLE CLINIC DOCTOR DUTY STATUS (Busy / On Duty / Off Duty / On Leave)
// @route   PATCH /api/clinic/doctor-panel/duty-status
// @access  Private (Clinic Doctor)
// ==========================================
const updateDoctorDutyStatus = async (req, res) => {
    try {
        const { dutyStatus, status, isBusy } = req.body || {};

        let resolvedStatus = dutyStatus || status;

        // Shorthand support: { isBusy: true } or { isBusy: false }
        if (!resolvedStatus && typeof isBusy === 'boolean') {
            resolvedStatus = isBusy ? 'Busy' : 'On Duty';
        }

        const allowedStatuses = ['On Duty', 'Off Duty', 'On Leave', 'Busy'];
        if (!resolvedStatus || !allowedStatuses.includes(resolvedStatus)) {
            return res.status(400).json({
                success: false,
                message: `Valid status is required. Allowed: ${allowedStatuses.join(', ')} (or pass isBusy: true/false).`
            });
        }

        const doctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            {
                $set: {
                    dutyStatus: resolvedStatus,
                    isOnline: resolvedStatus !== 'Off Duty' && resolvedStatus !== 'On Leave'
                }
            },
            { new: true }
        )
            .select('_id name dutyStatus isOnline isActive')
            .lean();

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor profile not found."
            });
        }

        return res.status(200).json({
            success: true,
            message: `Duty status updated to '${doctor.dutyStatus}'.`,
            isBusy: doctor.dutyStatus === 'Busy',
            dutyStatus: doctor.dutyStatus,
            data: doctor
        });
    } catch (error) {
        console.error("Update Clinic Doctor Duty Status Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    getMyDoctorProfile,
    updateDoctorProfile,
    getLatestDoctorProfileRequest,
    applyDoctorLeave,
    getDoctorLeavesHistory,
    checkDoctorBusyStatus,
    updateDoctorDutyStatus
};