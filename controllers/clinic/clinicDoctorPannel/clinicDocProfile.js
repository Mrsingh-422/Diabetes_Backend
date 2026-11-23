// controllers/clinic/clinicDoctorPannel/clinicDocProfile.js

const Doctor = require('../../../models/Doctor');
const Clinic = require('../../../models/Clinic');
const Appointment = require('../../../models/Appointment');
const Availability = require('../../../models/Availability');
const Admin = require('../../../models/Admin');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const mongoose = require('mongoose');
const moment = require('moment');
const { deleteFile } = require('../../../utils/fileHandler');
const { sendPushNotification } = require('../../../utils/notification');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT_TO_FULL = {
    mon: 'Monday', monday: 'Monday',
    tue: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday', thursday: 'Thursday',
    fri: 'Friday', friday: 'Friday',
    sat: 'Saturday', saturday: 'Saturday',
    sun: 'Sunday', sunday: 'Sunday'
};
const DAY_FULL_TO_SHORT = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
    Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
};

const normalizeTime24 = (timeStr, fallback = "09:00") => {
    if (!timeStr) return fallback;
    const clean = String(timeStr).trim();
    if (/^\d{1,2}:\d{2}$/.test(clean)) {
        const [h, m] = clean.split(':').map(Number);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const parsed = moment(clean, ["hh:mm A", "h:mm A", "HH:mm", "H:mm", "hh:mma", "h:mma"]);
    return parsed.isValid() ? parsed.format("HH:mm") : fallback;
};

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

        if (fees_online !== undefined || fees_clinic !== undefined || fees_home !== undefined) {
            updates.fees = {
                online: fees_online !== undefined ? Number(fees_online) : (existingDoc.fees?.online || 0),
                clinic: fees_clinic !== undefined ? Number(fees_clinic) : (existingDoc.fees?.clinic || 0),
                home: fees_home !== undefined ? Number(fees_home) : (existingDoc.fees?.home || 0)
            };
        } else if (fees) {
            updates.fees = typeof fees === 'string' ? JSON.parse(fees) : fees;
        }

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

        const request = await ProfileUpdateRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            updatedFields: updates,
            status: 'Pending'
        });

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
// @route   GET /api/clinic/doctor-panel/busy-status
// @route   GET /api/clinic/doctor-panel/busy-status/:doctorId
// @access  Private (Clinic Doctor or Clinic)
// ==========================================
const checkDoctorBusyStatus = async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        let targetDoctorId = req.user.id;
        let clinicFilter = {};

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

        const activeInProgressAppointments = await Appointment.find({
            doctorId: doctor._id,
            status: 'In-Progress'
        })
            .select('_id bookingId bookingType consultationType appointmentDate appointmentTime wardName bedNumber patients')
            .lean();

        const todayStart = moment().startOf('day');
        const todayEnd = moment().endOf('day');
        const isOnApprovedLeaveToday = (doctor.leaves || []).some((l) => {
            if (l.status !== 'Approved') return false;
            return moment(l.startDate).isSameOrBefore(todayEnd) && moment(l.endDate).isSameOrAfter(todayStart);
        });

        const currentDutyStatus = doctor.dutyStatus || 'On Duty';
        const hasActiveInProgressCase = activeInProgressAppointments.length > 0;
        const isBusy = currentDutyStatus === 'Busy' || hasActiveInProgressCase;

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

// ==========================================
// 8. GET CLINIC DOCTOR'S ALL SLOTS, SHIFT TIMINGS, CABIN & FEES
// @route   GET /api/clinic/doctor-panel/opd-settings?date=YYYY-MM-DD
// @access  Private (Clinic Doctor)
// ==========================================
const getDoctorOpdSettings = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { date } = req.query;

        const targetDateStr = date && String(date).trim() !== ''
            ? String(date).trim()
            : moment().format("YYYY-MM-DD");

        const targetMoment = moment(targetDateStr, "YYYY-MM-DD", true);
        if (!targetMoment.isValid()) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format. Please use YYYY-MM-DD."
            });
        }

        const [doctor, availConfig] = await Promise.all([
            Doctor.findById(doctorId)
                .populate('clinicId', 'name clinicName city address phoneNumber image')
                .select('name speciality qualification profileImage cabinNumber department fees consultationStatus isClinicAvailable isOnlineAvailable isHomeAvailable slotDuration availability leaves dutyStatus clinicId')
                .lean(),
            Availability.findOne({ vendorId: doctorId }).lean()
        ]);

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor profile not found."
            });
        }

        const startTime24 = normalizeTime24(availConfig?.startTime, "09:00");
        const endTime24 = normalizeTime24(availConfig?.endTime, "17:00");
        const duration = Math.max(5, Number(availConfig?.slotDuration || doctor.slotDuration || 30));

        // Resolve Fees (Clinic, Online, Home)
        const fees = {
            clinic: Number(doctor.fees?.clinic || 0),
            online: Number(doctor.fees?.online || 0),
            home: Number(doctor.fees?.home || 0)
        };

        const consultationModes = {
            clinic: doctor.isClinicAvailable !== false && doctor.consultationStatus?.clinic !== false,
            online: doctor.isOnlineAvailable !== false && doctor.consultationStatus?.online !== false,
            home: Boolean(doctor.isHomeAvailable || doctor.consultationStatus?.home)
        };

        // Resolve Weekly Roster (offDays vs activeDays)
        let offDays = (availConfig?.offDays || []).map(
            (d) => DAY_SHORT_TO_FULL[String(d).trim().toLowerCase()] || d
        );
        if (offDays.length === 0 && Array.isArray(doctor.availability) && doctor.availability.length > 0) {
            const activeSet = new Set(
                doctor.availability.map((a) => DAY_SHORT_TO_FULL[String(a.day).trim().toLowerCase()]).filter(Boolean)
            );
            offDays = FULL_DAYS.filter((d) => !activeSet.has(d));
        }
        const activeDays = FULL_DAYS.filter((d) => !offDays.includes(d));

        // Format Premium, Blocked & Leave Lists
        const premiumSlots = (availConfig?.premiumSlots || []).map((ps) => {
            const t24 = normalizeTime24(ps.time, ps.time);
            const extraFee = Number(ps.extraFee || 0);
            return {
                time: moment(t24, "HH:mm").format("hh:mm A"),
                time24: t24,
                extraFee,
                totalClinicFee: fees.clinic + extraFee
            };
        });

        const unavailableSlots = (availConfig?.unavailableSlots || []).map((t) => {
            const t24 = normalizeTime24(t, t);
            return {
                time: moment(t24, "HH:mm").format("hh:mm A"),
                time24: t24
            };
        });

        const blockedSlotsWithReason = (availConfig?.blockedSlotsWithReason || []).map((b) => {
            const t24 = normalizeTime24(b.time, b.time);
            return {
                date: moment(b.date).format("YYYY-MM-DD"),
                time: moment(t24, "HH:mm").format("hh:mm A"),
                time24: t24,
                reason: b.reason || "Blocked",
                blockedAt: b.blockedAt || null
            };
        });

        const approvedLeaves = (doctor.leaves || [])
            .filter((l) => l.status === 'Approved')
            .map((l) => ({
                _id: l._id,
                startDate: moment(l.startDate).format("YYYY-MM-DD"),
                endDate: moment(l.endDate).format("YYYY-MM-DD"),
                reason: l.reason
            }));

        // Build Date-wise Live Slots Grid
        const dayFull = targetMoment.format("dddd");
        const dayShort = targetMoment.format("ddd");
        const blockedDates = availConfig?.blockedDates || [];

        const isApprovedLeaveDate = approvedLeaves.some(
            (l) => targetDateStr >= l.startDate && targetDateStr <= l.endDate
        );
        const isOffDay = offDays.includes(dayFull);
        const isBlockedDate = blockedDates.includes(targetDateStr) || isApprovedLeaveDate;

        let liveSlots = {
            date: targetDateStr,
            day: dayFull,
            dayShort,
            isClosed: false,
            closedReason: null,
            totalSlots: 0,
            availableCount: 0,
            bookedCount: 0,
            blockedCount: 0,
            slots: []
        };

        if (!consultationModes.clinic) {
            liveSlots.isClosed = true;
            liveSlots.closedReason = "Clinic OPD is currently disabled.";
        } else if (isBlockedDate) {
            liveSlots.isClosed = true;
            liveSlots.closedReason = `You are on Leave / Unavailable on ${targetDateStr}.`;
        } else if (isOffDay) {
            liveSlots.isClosed = true;
            liveSlots.closedReason = `${dayFull} is marked as your Weekly Off.`;
        } else {
            const rawSlots = generateTimeSlots({
                startTime: startTime24,
                endTime: endTime24,
                slotDuration: duration,
                morningSlots: availConfig?.morningSlots !== false,
                afternoonSlots: availConfig?.afternoonSlots !== false,
                eveningSlots: availConfig?.eveningSlots !== false,
                unavailableSlots: [],
                premiumSlots: availConfig?.premiumSlots || []
            });

            const dayStart = targetMoment.clone().startOf('day').toDate();
            const dayEnd = targetMoment.clone().endOf('day').toDate();

            const bookedAppts = await Appointment.find({
                doctorId: doctor._id,
                bookingType: { $in: ['Appointment', 'Emergency'] },
                status: { $in: ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Completed'] },
                appointmentDate: { $gte: dayStart, $lte: dayEnd }
            }).select('appointmentTime bookingId status patients').lean();

            const bookedMap = {};
            bookedAppts.forEach((b) => {
                const t24 = normalizeTime24(b.appointmentTime, "");
                if (t24) bookedMap[t24] = b;
            });

            const unavailableSet = new Set(unavailableSlots.map((u) => u.time24));
            const dateBlockedMap = {};
            blockedSlotsWithReason.forEach((b) => {
                if (b.date === targetDateStr) {
                    dateBlockedMap[b.time24] = b.reason;
                }
            });

            const nowIST = moment().utcOffset("+05:30");
            const isToday = targetDateStr === nowIST.format("YYYY-MM-DD");

            const generated = rawSlots.map((s) => {
                const t24 = s.slotTime;
                const formatted12 = moment(t24, "HH:mm").format("hh:mm A");
                const slotMomentIST = moment.utc(`${targetDateStr} ${t24}`, "YYYY-MM-DD HH:mm").utcOffset("+05:30");
                const isPast = isToday && slotMomentIST.isBefore(nowIST);

                const bookedInfo = bookedMap[t24] || null;
                const dateBlockReason = dateBlockedMap[t24] || null;
                const isRecurringBlocked = unavailableSet.has(t24);

                let status = "Available";
                if (dateBlockReason || isRecurringBlocked) status = "Blocked";
                else if (bookedInfo) status = bookedInfo.status === 'Completed' ? "Completed" : "Booked";
                else if (isPast) status = "Past";

                return {
                    time: formatted12,
                    time24: t24,
                    displayTime: s.displayTime,
                    category: s.category,
                    status,
                    isAvailable: status === "Available",
                    isPremium: s.isPremium,
                    extraFee: s.extraFee,
                    baseClinicFee: fees.clinic,
                    totalFee: fees.clinic + s.extraFee,
                    blockReason: dateBlockReason || (isRecurringBlocked ? "Blocked recurring slot" : null),
                    bookingDetails: bookedInfo ? {
                        appointmentId: bookedInfo._id,
                        bookingId: bookedInfo.bookingId,
                        patientName: bookedInfo.patients?.[0]?.patientName || "Patient",
                        status: bookedInfo.status
                    } : null
                };
            });

            liveSlots.totalSlots = generated.length;
            liveSlots.availableCount = generated.filter((x) => x.isAvailable).length;
            liveSlots.bookedCount = generated.filter((x) => x.status === 'Booked' || x.status === 'Completed').length;
            liveSlots.blockedCount = generated.filter((x) => x.status === 'Blocked').length;
            liveSlots.slots = generated;
        }

        return res.status(200).json({
            success: true,
            message: "Clinic doctor OPD slots and fees fetched successfully.",
            data: {
                doctor: {
                    _id: doctor._id,
                    name: doctor.name,
                    speciality: doctor.speciality,
                    qualification: doctor.qualification,
                    profileImage: doctor.profileImage,
                    dutyStatus: doctor.dutyStatus || "On Duty",
                    cabinNumber: doctor.cabinNumber || doctor.department?.roomNumber || "",
                    slotDurationMinutes: duration,
                    clinic: doctor.clinicId ? {
                        _id: doctor.clinicId._id,
                        name: doctor.clinicId.clinicName || doctor.clinicId.name,
                        city: doctor.clinicId.city || "",
                        address: doctor.clinicId.address || "",
                        image: doctor.clinicId.image || null
                    } : null
                },
                fees,
                consultationModes,
                isConfiguredByClinic: Boolean(availConfig),
                generalSchedule: {
                    startTime: startTime24,
                    endTime: endTime24,
                    startTime12h: moment(startTime24, "HH:mm").format("hh:mm A"),
                    endTime12h: moment(endTime24, "HH:mm").format("hh:mm A"),
                    slotDurationMinutes: duration,
                    morningSlots: availConfig?.morningSlots !== false,
                    afternoonSlots: availConfig?.afternoonSlots !== false,
                    eveningSlots: availConfig?.eveningSlots !== false,
                    weeklyAvailability: doctor.availability || []
                },
                weeklyRoster: {
                    activeDaysCount: activeDays.length,
                    offDaysCount: offDays.length,
                    activeDays,
                    offDays,
                    daysList: FULL_DAYS.map((dayName) => ({
                        day: dayName,
                        shortDay: DAY_FULL_TO_SHORT[dayName],
                        isActive: !offDays.includes(dayName)
                    }))
                },
                premiumSlots,
                unavailableSlots,
                blockedSlotsWithReason,
                blockedDates,
                approvedLeaves,
                liveSlots
            }
        });
    } catch (error) {
        console.error("Get Clinic Doctor OPD Settings Error:", error);
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
    updateDoctorDutyStatus,
    getDoctorOpdSettings
};