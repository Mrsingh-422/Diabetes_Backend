// controllers/clinic/clinicDoctorPannel/clinicDocAppointment.js

const Appointment = require('../../../models/Appointment');
const Doctor = require('../../../models/Doctor');
const Clinic = require('../../../models/Clinic');
const Prescription = require('../../../models/Prescription');
const User = require('../../../models/User');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');
const Pharmacy = require('../../../models/Pharmacy');
const Lab = require('../../../models/Lab');
const ReferredToAnotherDoctor = require('../../../models/ReferredToAnotherDoctor');
const { syncClinicWardAndBedCapacity } = require('../../../utils/opdTokenHelper');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');
const mongoose = require('mongoose');
const moment = require('moment');
const { sendPushNotification } = require('../../../utils/notification');

// ==========================================
// Helper 1: Human-readable shift duration
// ==========================================
const formatShiftDuration = (startTime, endTime = new Date()) => {
    if (!startTime) return "0 mins";
    const diffMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    parts.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return parts.join(' ');
};

// ==========================================
// Helper: Build Structured Medicine Dose & Time-of-Day Schedule
// ==========================================
const parseMedicineDoseAndSchedule = (m = {}) => {
    const medName = String(m.name || m.medicineName || "").trim();
    const strengthVal = String(m.strength || "").trim();
    const rawDoseInterval = String(m.doseInterval || m.dose || "").trim();
    const freqVal = String(m.frequency || "q.d.").trim();
    const durationVal = String(m.duration || "5 Days").trim();
    const qtyVal = String(m.dispenseQuantity || m.quantity || "10 Tablets").trim();
    const timingText = String(m.administrationTiming || m.instructions || "").trim();

    let scheduleInput = m.timeSchedule || {};
    if (typeof scheduleInput === 'string') {
        try { scheduleInput = JSON.parse(scheduleInput); } catch (e) { scheduleInput = {}; }
    }

    let morning = Boolean(scheduleInput.morning);
    let afternoon = Boolean(scheduleInput.afternoon);
    let evening = Boolean(scheduleInput.evening);
    let night = Boolean(scheduleInput.night);

    // Auto-parse "1-0-1" or "1-1-1-1" if boolean checkboxes were not explicitly sent
    if (!morning && !afternoon && !evening && !night && rawDoseInterval) {
        const parts = rawDoseInterval.split('-').map((p) => Number(p.trim()));
        if (parts.length === 3) {
            morning = parts[0] > 0;
            afternoon = parts[1] > 0;
            night = parts[2] > 0;
        } else if (parts.length === 4) {
            morning = parts[0] > 0;
            afternoon = parts[1] > 0;
            evening = parts[2] > 0;
            night = parts[3] > 0;
        }
    }

    const finalDoseInterval = rawDoseInterval || `${morning ? 1 : 0}-${afternoon ? 1 : 0}-${night ? 1 : 0}`;
    const timeLabels = [];
    if (morning) timeLabels.push("Morning");
    if (afternoon) timeLabels.push("Afternoon");
    if (evening) timeLabels.push("Evening");
    if (night) timeLabels.push("Night");

    const allowedMealRelations = ['Before Meal', 'After Meal', 'With Meal', 'Empty Stomach', 'Anytime', ''];
    const mealRelation = allowedMealRelations.includes(scheduleInput.mealRelation)
        ? scheduleInput.mealRelation
        : '';

    const customTimes = Array.isArray(scheduleInput.customTimes)
        ? scheduleInput.customTimes.map((t) => String(t).trim()).filter(Boolean)
        : [];

    return {
        medicineId: (m.medicineId && mongoose.Types.ObjectId.isValid(m.medicineId)) ? m.medicineId : null,
        name: medName,
        isCustomGeneric: Boolean(m.isCustomGeneric === true || m.isCustomGeneric === 'true'),
        genericComposition: String(m.genericComposition || "").trim(),
        strength: strengthVal,
        frequency: freqVal,
        doseInterval: finalDoseInterval,
        dose: finalDoseInterval,
        time: String(m.time || timeLabels.join(' - ')).trim(),
        duration: durationVal,
        dispenseQuantity: qtyVal,
        administrationTiming: timingText || mealRelation,
        instructions: timingText || mealRelation,
        timeSchedule: {
            morning,
            afternoon,
            evening,
            night,
            mealRelation,
            customTimes
        }
    };
};


// ==========================================
// Helper 2: Enrich treatmentHistory with live shift durations
// ==========================================
const enrichTreatmentHistory = (historyArray = [], appointmentStatus = 'Pending') => {
    const now = new Date();
    const isCaseClosed = [
        'Completed',
        'Cancelled-By-User',
        'Cancelled-By-Doctor',
        'Cancelled-By-Clinic',
        'No-Show'
    ].includes(appointmentStatus);

    return (historyArray || []).map((item, index) => {
        const startRef = item.assignedAt || item.startTime || item.timestamp;
        const endRef = item.endTime || null;
        const isLastEntry = index === historyArray.length - 1;

        let computedDuration = item.durationDisplay || "";
        if (!computedDuration && startRef) {
            if (!endRef && !isCaseClosed && isLastEntry) {
                computedDuration = `${formatShiftDuration(startRef, now)} (Active Duty)`;
            } else {
                computedDuration = formatShiftDuration(startRef, endRef || now);
            }
        }

        return {
            ...item,
            stepNumber: index + 1,
            fromDoctorName: item.fromDoctorId?.name || null,
            fromDoctorSpeciality: item.fromDoctorId?.speciality || null,
            toDoctorName: item.toDoctorId?.name || "Assigned Doctor",
            toDoctorSpeciality: item.toDoctorId?.speciality || null,
            acceptanceStatus: item.acceptanceStatus || 'Pending-Acceptance',
            isCurrentlyActive: Boolean(!endRef && !isCaseClosed && isLastEntry && item.acceptanceStatus === 'Accepted'),
            isAwaitingAcceptance: Boolean(!endRef && !isCaseClosed && isLastEntry && item.acceptanceStatus === 'Pending-Acceptance'),
            durationDisplay: computedDuration
        };
    });
};

// ==========================================
// Helper 3: Resolve Clean Patient Profile
// ==========================================
const resolvePatientProfile = (appt) => {
    const user = appt.userId;
    const primaryPatient = Array.isArray(appt.patients) && appt.patients.length > 0 ? appt.patients[0] : {};

    const rawName = (primaryPatient.patientName || "").trim();
    const lowerName = rawName.toLowerCase();
    const lowerRel = (primaryPatient.relation || "").trim().toLowerCase();

    const isSelf =
        Boolean(primaryPatient.isMainUser) ||
        lowerRel === 'self' ||
        lowerName === 'self' ||
        lowerName.includes('myself') ||
        !rawName;

    let matchedFamilyMember = null;
    if (!isSelf && user?.familyMember && Array.isArray(user.familyMember)) {
        matchedFamilyMember = user.familyMember.find(
            (fm) =>
                (fm.memberName && rawName && fm.memberName.trim().toLowerCase() === lowerName) ||
                (fm.relation && lowerRel && fm.relation.trim().toLowerCase() === lowerRel)
        );
    }

    const resolvedName = isSelf
        ? (user?.name || rawName || "Patient")
        : (rawName || matchedFamilyMember?.memberName || "Family Member");

    const resolvedAge =
        primaryPatient.patientAge ||
        (matchedFamilyMember?.dob ? moment().diff(moment(matchedFamilyMember.dob), 'years') : null) ||
        user?.age ||
        (user?.dob ? moment().diff(moment(user.dob), 'years') : null);

    const resolvedGender =
        primaryPatient.gender ||
        matchedFamilyMember?.gender ||
        (isSelf ? user?.gender : null) ||
        "N/A";

    const resolvedBloodGroup =
        appt.clinicalSummary?.bloodGroup ||
        (isSelf ? user?.bloodgroup : null) ||
        "N/A";

    const resolvedPhone =
        appt.address?.phone ||
        matchedFamilyMember?.phone ||
        user?.phone ||
        "N/A";

    const resolvedProfilePic =
        (!isSelf && matchedFamilyMember?.profilePic)
            ? matchedFamilyMember.profilePic
            : (user?.profilePic || null);

    return {
        patientName: resolvedName,
        age: resolvedAge,
        gender: resolvedGender,
        relation: isSelf ? "Self" : (matchedFamilyMember?.relation || primaryPatient.relation || "Family Member"),
        phone: resolvedPhone,
        email: isSelf ? (user?.email || null) : null,
        bloodGroup: resolvedBloodGroup,
        profilePic: resolvedProfilePic,
        reasonForVisit: primaryPatient.reasonForVisit || appt.bookingReason || "",
        isMainUser: isSelf,
        diabeticProfile: isSelf && user ? {
            diabeticType: user.diabeticType || "",
            sinceHowLong: user.sinceHowLong?.formatted || user.diabeticduration || "",
            height: user.height || "",
            weight: user.weight || "",
            takingMedicines: user.takingmedicines || "",
            conditionStatus: user.conditionStatus || null,
            familyHistory: user.familyHistory || null
        } : null
    };
};

// ==========================================
// Helper 4: Build Flexible Appointment ID Query (_id or bookingId)
// ==========================================
const buildAppointmentIdQuery = (idParam) => {
    const cleanId = String(idParam || '').trim();
    if (!cleanId) return null;
    return mongoose.Types.ObjectId.isValid(cleanId)
        ? { $or: [{ _id: cleanId }, { bookingId: cleanId }] }
        : { bookingId: cleanId };
};

// ==========================================
// 1. GET CLINIC DOCTOR APPOINTMENTS LIST
// @route   GET /api/clinic/doctor-panel/appointments
// ==========================================
const getClinicDoctorAppointments = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;

        const {
            tab = 'all',
            bookingType,
            status,
            date,
            search,
            page = 1,
            limit = 20
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (pageNum - 1) * limitNum;

        const andConditions = [];

        // 1. Base Ownership Filter
        const normalizedTab = String(tab || 'all').toLowerCase();
        if (normalizedTab === 'handover') {
            andConditions.push({ pendingDoctorId: doctorId });
        } else if (normalizedTab === 'bedside') {
            andConditions.push({ 'bedsideCareTeam.doctorId': doctorId });
        } else if (normalizedTab === 'all') {
            andConditions.push({
                $or: [
                    { doctorId: doctorId },
                    { pendingDoctorId: doctorId },
                    { 'bedsideCareTeam.doctorId': doctorId }
                ]
            });
        } else {
            andConditions.push({ doctorId: doctorId });
        }

        if (clinicId) {
            andConditions.push({ clinicId });
        }

        // 2. Tab / Booking Type Filter
        if (bookingType && String(bookingType).trim() !== '') {
            andConditions.push({ bookingType: String(bookingType).trim() });
        } else if (normalizedTab === 'opd') {
            andConditions.push({ bookingType: 'Appointment' });
        } else if (normalizedTab === 'ipd') {
            andConditions.push({ bookingType: 'Admission' });
        } else if (normalizedTab === 'emergency') {
            andConditions.push({
                $or: [
                    { bookingType: 'Emergency' },
                    { triageLevel: 'Emergency' }
                ]
            });
        }

        // 3. Status Filter
        if (status && String(status).trim() !== '') {
            const cleanStatus = String(status).trim();
            if (cleanStatus.toLowerCase() === 'active') {
                andConditions.push({
                    status: { $in: ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending', 'Rescheduled'] }
                });
            } else if (cleanStatus.toLowerCase() === 'history') {
                andConditions.push({
                    status: { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'] }
                });
            } else {
                andConditions.push({ status: cleanStatus });
            }
        }

        // 4. Optional Date Filter
        if (date && date !== 'all' && String(date).trim() !== '') {
            const targetMoment = String(date).toLowerCase() === 'today' ? moment() : moment(date);
            if (!targetMoment.isValid()) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date format. Please use YYYY-MM-DD or 'today'."
                });
            }
            const dayStart = targetMoment.clone().startOf('day').toDate();
            const dayEnd = targetMoment.clone().endOf('day').toDate();

            andConditions.push({
                $or: [
                    { appointmentDate: { $gte: dayStart, $lte: dayEnd } },
                    {
                        bookingType: { $in: ['Admission', 'Emergency'] },
                        startDate: { $lte: dayEnd },
                        endDate: { $gte: dayStart }
                    }
                ]
            });
        }

        // 5. Search Filter
        if (search && String(search).trim() !== '') {
            const regex = new RegExp(String(search).trim(), 'i');
            andConditions.push({
                $or: [
                    { bookingId: regex },
                    { "patients.patientName": regex },
                    { "address.name": regex },
                    { "address.phone": regex },
                    { wardName: regex },
                    { bedNumber: regex },
                    { bookingReason: regex }
                ]
            });
        }

        const query = andConditions.length > 0 ? { $and: andConditions } : {};

        const summaryMatch = { doctorId: new mongoose.Types.ObjectId(doctorId) };
        if (clinicId) summaryMatch.clinicId = new mongoose.Types.ObjectId(clinicId);

        const [
            totalDocs,
            appointments,
            opdCount,
            ipdCount,
            emergencyCount,
            pendingHandoversCount,
            bedsideRequestsCount
        ] = await Promise.all([
            Appointment.countDocuments(query),
            Appointment.find(query)
                .populate('userId', 'name phone email profilePic gender dob age bloodgroup familyMember')
                .populate('clinicId', 'name clinicName city state address phoneNumber image')
                .populate('wardId', 'name type pricePerDay')
                .populate('bedId', 'bedNumber status pricePerDay')
                .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
                .sort({ appointmentDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Appointment.countDocuments({
                ...summaryMatch,
                bookingType: 'Appointment',
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
            }),
            Appointment.countDocuments({
                ...summaryMatch,
                bookingType: 'Admission',
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
            }),
            Appointment.countDocuments({
                ...summaryMatch,
                $or: [{ bookingType: 'Emergency' }, { triageLevel: 'Emergency' }],
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
            }),
            Appointment.countDocuments({
                ...(clinicId ? { clinicId } : {}),
                pendingDoctorId: doctorId,
                status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
            }),
            Appointment.countDocuments({
                ...(clinicId ? { clinicId } : {}),
                'bedsideCareTeam.doctorId': doctorId,
                status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
            })
        ]);

        const formattedList = appointments.map((appt) => {
            const patientProfile = resolvePatientProfile(appt);
            const categoryTag = appt.bookingType === 'Admission'
                ? 'IPD'
                : (appt.bookingType === 'Emergency' ? 'EMERGENCY' : 'OPD');

            const dateVal = appt.appointmentDate || appt.startDate;
            const latestHistory = Array.isArray(appt.treatmentHistory) && appt.treatmentHistory.length > 0
                ? appt.treatmentHistory[appt.treatmentHistory.length - 1]
                : null;

            const isPendingHandover = Boolean(
                appt.pendingDoctorId && appt.pendingDoctorId.toString() === String(doctorId)
            );
            const acceptanceState = appt.doctorAcceptanceStatus || 'Pending';

            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                bookingType: appt.bookingType,
                categoryTag,
                consultationType: appt.consultationType || 'Clinic Visit',
                status: appt.status,
                doctorAcceptanceStatus: acceptanceState,
                triageLevel: appt.triageLevel || null,
                bookingReason: appt.bookingReason || patientProfile.reasonForVisit || "",
                isDoctorSelectedAlready: Boolean(appt.isDoctorSelectedAlready),

                appointmentDate: dateVal ? moment(dateVal).format('YYYY-MM-DD') : null,
                appointmentTime: appt.appointmentTime || "10:30 AM",

                patient: {
                    name: patientProfile.patientName,
                    age: patientProfile.age,
                    gender: patientProfile.gender,
                    relation: patientProfile.relation,
                    phone: patientProfile.phone,
                    bloodGroup: patientProfile.bloodGroup,
                    profilePic: patientProfile.profilePic,
                    reasonForVisit: patientProfile.reasonForVisit
                },

                stayDetails: (appt.bedId || appt.wardId || appt.bedNumber || appt.wardName) ? {
                    wardId: appt.wardId?._id || appt.wardId || null,
                    wardName: appt.wardName || appt.wardId?.name || null,
                    wardType: appt.wardId?.type || null,
                    bedId: appt.bedId?._id || appt.bedId || null,
                    bedNumber: appt.bedNumber || appt.bedId?.bedNumber || null,
                    bedStatus: appt.bedId?.status || null,
                    stayDuration: appt.stayDuration || 1,
                    startDate: appt.startDate ? moment(appt.startDate).format('YYYY-MM-DD') : null,
                    endDate: appt.endDate ? moment(appt.endDate).format('YYYY-MM-DD') : null
                } : null,

                clinic: appt.clinicId ? {
                    _id: appt.clinicId._id,
                    name: appt.clinicId.clinicName || appt.clinicId.name,
                    city: appt.clinicId.city || "",
                    image: appt.clinicId.image || null
                } : null,

                payment: {
                    totalAmount: appt.totalAmount || 0,
                    paymentStatus: appt.paymentStatus || 'Pending',
                    paymentMethod: appt.paymentMethod || appt.paymentDetails?.method || null
                },

                assignmentMeta: {
                    doctorAcceptanceStatus: acceptanceState,
                    lastAction: latestHistory?.action || null,
                    assignedAt: latestHistory?.assignedAt || latestHistory?.startTime || latestHistory?.timestamp || appt.createdAt,
                    isPendingHandover,
                    canRespondToAssignment: (acceptanceState === 'Pending' || isPendingHandover) &&
                        !['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'].includes(appt.status)
                },

                createdAt: appt.createdAt,
                updatedAt: appt.updatedAt
            };
        });

        return res.status(200).json({
            success: true,
            tab,
            summary: {
                opdCount,
                ipdCount,
                emergencyCount,
                pendingHandoversCount,
                bedsideRequestsCount
            },
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: formattedList.length,
            data: formattedList
        });

    } catch (error) {
        console.error("Get Clinic Doctor Appointments Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
// ==========================================
// 2. GET SINGLE CLINIC DOCTOR APPOINTMENT FULL DETAILS BY ID
// @route   GET /api/clinic/doctor-panel/appointments/:id
// ==========================================
const getClinicDoctorAppointmentById = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const { id } = req.params;

        const idQuery = buildAppointmentIdQuery(id);
        if (!idQuery) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID or bookingId is required."
            });
        }

        // Fixed: Using $and so idQuery.$or is never overwritten by ownership $or
        const accessQuery = {
            $and: [
                idQuery,
                ...(clinicId ? [{ clinicId }] : []),
                {
                    $or: [
                        { doctorId: doctorId },
                        { pendingDoctorId: doctorId },
                        { 'bedsideCareTeam.doctorId': doctorId }
                    ]
                }
            ]
        };

        const appointment = await Appointment.findOne(accessQuery)
            .populate(
                'userId',
                'name email phone profilePic gender dob age bloodgroup height weight diabeticType sinceHowLong diabeticduration takingmedicines otherMedicalCondition conditionStatus familyHistory familyMember insuranceDetails emergencyContact userAddress'
            )
            .populate(
                'clinicId',
                'name clinicName email phoneNumber alternatePhoneNumber address city state country image posterimage is24x7 isOPD isIPD isEmergency isAmbulanceAvailable MorningStartTime MorningEndTime eveningStartTime eveningEndTime holiday'
            )
            .populate(
                'doctorId',
                'name email phone speciality qualification qualifications experienceYears gender profileImage signatureImage dutyStatus fees consultationStatus'
            )
            .populate(
                'pendingDoctorId',
                'name speciality qualification profileImage phone dutyStatus'
            )
            .populate('wardId', 'name type totalBeds availableBeds pricePerDay')
            .populate('bedId', 'bedNumber status pricePerDay')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverName pricing supportStaff')
            .populate('couponDetails.couponId', 'couponName discountPercentage maxDiscount')
            .populate('prescriptionId')
            .populate('clinicPharmacyReferral.pharmacyId', 'name phone address city')
            .populate('clinicLabReferral.labId', 'name phone address city')
            .populate('admissionReferral.wardId', 'name type pricePerDay')
            .populate('admissionReferral.bedId', 'bedNumber status pricePerDay')
            .populate('admissionReferral.admissionAppointmentId', 'bookingId status wardName bedNumber startDate endDate')
            .populate('treatmentHistory.fromDoctorId', 'name speciality qualification profileImage phone')
            .populate('treatmentHistory.toDoctorId', 'name speciality qualification profileImage phone')
            .populate('bedsideCareTeam.doctorId', 'name speciality qualification profileImage phone dutyStatus')
            .lean();

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or you are not authorized to view this case."
            });
        }

        const prescriptions = await Prescription.find({ appointmentId: appointment._id })
            .populate('doctorId', 'name speciality qualification signatureImage profileImage')
            .sort({ createdAt: -1 })
            .lean();

        const latestPrescription = prescriptions.length > 0 ? prescriptions[0] : null;
        const resolvedPatient = resolvePatientProfile(appointment);
        const enrichedTreatmentHistory = enrichTreatmentHistory(
            appointment.treatmentHistory,
            appointment.status
        );

        const treatmentTeamTimeline = [];
        if (appointment.doctorId) {
            const primaryShift = enrichedTreatmentHistory.find(
                (h) =>
                    h.toDoctorId &&
                    (h.toDoctorId._id?.toString() === appointment.doctorId._id?.toString())
            );
            treatmentTeamTimeline.push({
                doctorId: appointment.doctorId._id,
                name: appointment.doctorId.name,
                speciality: appointment.doctorId.speciality,
                qualification: appointment.doctorId.qualification || "MBBS",
                profileImage: appointment.doctorId.profileImage || null,
                role: "Primary Attending Doctor",
                joinedAt: primaryShift ? primaryShift.startTime : (appointment.startDate || appointment.createdAt),
                endedAt: primaryShift?.endTime || null,
                duration: primaryShift?.durationDisplay || ""
            });
        }

        if (Array.isArray(appointment.bedsideCareTeam) && appointment.bedsideCareTeam.length > 0) {
            appointment.bedsideCareTeam.forEach((member) => {
                if (member.doctorId) {
                    treatmentTeamTimeline.push({
                        doctorId: member.doctorId._id,
                        name: member.doctorId.name,
                        speciality: member.doctorId.speciality,
                        qualification: member.doctorId.qualification || "MBBS",
                        profileImage: member.doctorId.profileImage || null,
                        role: member.roleType || "Secondary-Doctor",
                        status: member.status,
                        priority: member.priority,
                        requestReason: member.requestReason,
                        requestedAt: member.requestedAt,
                        respondedAt: member.respondedAt
                    });
                }
            });
        }

        const clinicalFiles = {
            prescriptionPdf: latestPrescription?.pdfUrl || null,
            dietPlanPdf: latestPrescription?.dietPlanPdf || null,
            dischargeSummaryPdf: appointment.clinicalSummary?.dischargeSummaryPdf || null,
            uploadedReports: appointment.clinicalSummary?.uploadedReports || [],
            insuranceDocument: appointment.insuranceDetails?.insuranceDocument || null
        };

        let stayCalculation = null;
        if (appointment.bookingType === 'Admission' || appointment.bedId || appointment.wardId) {
            const perDayBedPrice = Number(
                appointment.bedId?.pricePerDay || appointment.wardId?.pricePerDay || 0
            );
            const checkIn = moment(appointment.startDate || appointment.createdAt);
            const checkOut = moment(appointment.clinicalSummary?.dischargedAt || new Date());
            const exactHours = Number(Math.max(0, checkOut.diff(checkIn) / (1000 * 60 * 60)).toFixed(1));
            const actualStayDays = Math.max(1, Math.ceil(exactHours / 24));
            const bookedDays = Number(appointment.stayDuration || 1);

            stayCalculation = {
                wardName: appointment.wardName || appointment.wardId?.name || null,
                wardType: appointment.wardId?.type || null,
                bedNumber: appointment.bedNumber || appointment.bedId?.bedNumber || null,
                bedStatus: appointment.bedId?.status || null,
                pricePerDay: perDayBedPrice,
                bookedDays,
                actualStayDays,
                exactStayHours: exactHours,
                startDate: appointment.startDate || null,
                endDate: appointment.endDate || null
            };
        }

        const billingSummary = {
            baseDoctorFee: appointment.pricingBreakdown?.baseFee || 0,
            originalBaseFee: appointment.pricingBreakdown?.originalBaseFee || 0,
            bedOrVisitCharges: appointment.pricingBreakdown?.visitCharges || 0,
            ambulanceOrExtraCharges: appointment.pricingBreakdown?.extraCharges || 0,
            specialServices: appointment.specialServices || [],
            discountAmount: appointment.pricingBreakdown?.discountAmount || 0,
            couponDetails: appointment.couponDetails || null,
            subtotal: appointment.pricingBreakdown?.subtotal || appointment.totalAmount || 0,
            totalAmount: appointment.totalAmount || 0,
            paymentStatus: appointment.paymentStatus || 'Pending',
            paymentMethod: appointment.paymentMethod || appointment.paymentDetails?.method || null,
            paymentDetails: appointment.paymentDetails || null
        };

        const isPrimaryDoctor = Boolean(
            appointment.doctorId &&
            appointment.doctorId._id?.toString() === String(doctorId)
        );
        const isPendingHandoverTarget = Boolean(
            appointment.pendingDoctorId &&
            appointment.pendingDoctorId._id?.toString() === String(doctorId)
        );
        const myBedsideEntry = Array.isArray(appointment.bedsideCareTeam)
            ? appointment.bedsideCareTeam.find(
                (m) => m.doctorId && m.doctorId._id?.toString() === String(doctorId)
            )
            : null;
        const acceptanceState = appointment.doctorAcceptanceStatus || 'Pending';

        return res.status(200).json({
            success: true,
            data: {
                ...appointment,
                categoryTag: appointment.bookingType === 'Admission'
                    ? 'IPD'
                    : (appointment.bookingType === 'Emergency' ? 'EMERGENCY' : 'OPD'),
                resolvedPatient,
                treatmentHistory: enrichedTreatmentHistory,
                treatmentTeamTimeline,
                stayCalculation,
                billingSummary,
                clinicalFiles,
                prescriptions,
                doctorPermissions: {
                    isPrimaryDoctor,
                    isPendingHandoverTarget,
                    doctorAcceptanceStatus: acceptanceState,
                    canRespondToAssignment: ((isPrimaryDoctor && acceptanceState === 'Pending') || isPendingHandoverTarget) &&
                        !['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'].includes(appointment.status),
                    isBedsideSpecialist: Boolean(myBedsideEntry),
                    bedsideRequestStatus: myBedsideEntry?.status || null
                }
            }
        });

    } catch (error) {
        console.error("Get Clinic Doctor Appointment By ID Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 3. ACCEPT OR REJECT (WITH REASON) ASSIGNED APPOINTMENT
// @route   PATCH /api/clinic/doctor-panel/appointments/respond
// @route   PATCH /api/clinic/doctor-panel/appointments/:id/respond
// ==========================================
const respondToAssignedAppointment = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;

        const targetApptId = req.params.id || req.body?.appointmentId || req.body?.bookingId;
        const rawAction = req.body?.action || req.body?.status;
        const reason = req.body?.reason || req.body?.rejectionReason || req.body?.notes || "";

        const idFilter = buildAppointmentIdQuery(targetApptId);
        if (!idFilter) {
            return res.status(400).json({
                success: false,
                message: "appointmentId (or bookingId) is required."
            });
        }

        const cleanAction = String(rawAction || '').trim().toLowerCase();
        let normalizedAction = null;
        if (['accept', 'accepted'].includes(cleanAction)) {
            normalizedAction = 'Accepted';
        } else if (['reject', 'rejected', 'decline', 'declined'].includes(cleanAction)) {
            normalizedAction = 'Rejected';
        }

        if (!normalizedAction) {
            return res.status(400).json({
                success: false,
                message: "Valid action ('Accept' or 'Reject') is required."
            });
        }

        const cleanReason = String(reason || '').trim();
        if (normalizedAction === 'Rejected' && cleanReason === '') {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is mandatory when rejecting an assigned appointment."
            });
        }

        // Fixed: Using $and so idFilter.$or is never overwritten
        const appointment = await Appointment.findOne({
            $and: [
                idFilter,
                ...(clinicId ? [{ clinicId }] : []),
                {
                    $or: [
                        { doctorId: doctorId },
                        { pendingDoctorId: doctorId }
                    ]
                }
            ]
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Assigned appointment not found for you in this clinic."
            });
        }

        const closedStatuses = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'];
        if (closedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot respond because appointment is already '${appointment.status}'.`
            });
        }

        const isPendingHandover = Boolean(
            appointment.pendingDoctorId && appointment.pendingDoctorId.toString() === String(doctorId)
        );
        const isCurrentDoctor = Boolean(
            appointment.doctorId && appointment.doctorId.toString() === String(doctorId)
        );

        const now = new Date();
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        if (normalizedAction === 'Accepted') {
            if (!isPendingHandover && isCurrentDoctor && appointment.doctorAcceptanceStatus === 'Accepted') {
                return res.status(400).json({
                    success: false,
                    message: "You have already accepted this appointment."
                });
            }

            const previousDoctorId = isPendingHandover && appointment.doctorId
                ? appointment.doctorId.toString()
                : null;

            let updatedExistingLog = false;

            for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
                const logItem = appointment.treatmentHistory[i];
                if (!logItem) continue;

                if (
                    logItem.toDoctorId &&
                    String(logItem.toDoctorId) === String(doctorId) &&
                    !logItem.endTime &&
                    logItem.acceptanceStatus !== 'Accepted'
                ) {
                    const assignedTime = logItem.assignedAt || logItem.startTime || logItem.timestamp || appointment.createdAt;
                    const waitDuration = formatShiftDuration(assignedTime, now);

                    if (logItem.action === 'Transfer-Initiated') {
                        logItem.action = 'Transfer-Accepted';
                    }
                    logItem.acceptanceStatus = 'Accepted';
                    logItem.acceptedAt = now;
                    logItem.startTime = logItem.startTime || now;
                    logItem.unacceptedWaitDuration = waitDuration;
                    logItem.durationDisplay = "Active Duty";
                    logItem.notes = cleanReason
                        ? `${logItem.notes || ''} | [Accepted by ${req.user.name} after ${waitDuration}: ${cleanReason}]`
                        : `${logItem.notes || ''} | [Accepted by ${req.user.name} after ${waitDuration}]`;
                    updatedExistingLog = true;
                } else if (isPendingHandover && !logItem.endTime && String(logItem.toDoctorId) !== String(doctorId)) {
                    const startRef = logItem.acceptedAt || logItem.startTime || logItem.timestamp;
                    logItem.endTime = now;
                    logItem.acceptanceStatus = 'Completed';
                    logItem.durationDisplay = `${formatShiftDuration(startRef, now)} (Handed over to ${req.user.name})`;
                }
            }

            if (!updatedExistingLog) {
                const waitDuration = formatShiftDuration(appointment.createdAt, now);
                appointment.treatmentHistory.push({
                    fromDoctorId: previousDoctorId || null,
                    toDoctorId: doctorId,
                    action: isPendingHandover ? 'Transfer-Accepted' : 'Initial-Assignment',
                    acceptanceStatus: 'Accepted',
                    assignedAt: appointment.createdAt || now,
                    acceptedAt: now,
                    unacceptedWaitDuration: waitDuration,
                    notes: cleanReason || `Appointment accepted by ${req.user.name}.`,
                    timestamp: now,
                    startTime: now,
                    endTime: null,
                    durationDisplay: "Active Duty"
                });
            }

            appointment.doctorId = doctorId;
            appointment.pendingDoctorId = null;
            appointment.doctorAcceptanceStatus = 'Accepted';
            appointment.doctorRejectionReason = "";
            appointment.doctorRespondedAt = now;

            if (['Pending', 'Clinic-Pending'].includes(appointment.status)) {
                appointment.status = 'Confirmed';
            }

            await appointment.save();

            Promise.allSettled([
                appointment.userId
                    ? sendPushNotification(
                        appointment.userId,
                        'user',
                        "Doctor Confirmed Your Appointment",
                        `${req.user.name} has accepted your ${appointment.bookingType} (#${appointment.bookingId}).`,
                        {
                            appointmentId: String(appointment._id),
                            bookingId: String(appointment.bookingId || ""),
                            type: "CLINIC_DOCTOR_ACCEPTED_APPOINTMENT"
                        }
                    )
                    : Promise.resolve(),
                previousDoctorId && previousDoctorId !== String(doctorId)
                    ? sendPushNotification(
                        previousDoctorId,
                        'doctor',
                        "Handover Accepted",
                        `${req.user.name} accepted case #${appointment.bookingId}.`,
                        {
                            appointmentId: String(appointment._id),
                            bookingId: String(appointment.bookingId || ""),
                            type: "HANDOVER_ACCEPTED"
                        }
                    )
                    : Promise.resolve()
            ]).catch((err) => console.error("Accept Notification Error:", err.message));

            const populatedAppointment = await Appointment.findById(appointment._id)
                .populate('doctorId', 'name speciality qualification profileImage phone dutyStatus')
                .populate('clinicId', 'name clinicName city address')
                .populate('userId', 'name phone email')
                .lean();

            return res.status(200).json({
                success: true,
                action: 'Accepted',
                doctorAcceptanceStatus: 'Accepted',
                message: `Appointment #${appointment.bookingId} accepted successfully.`,
                data: populatedAppointment
            });
        }

        // REJECT FLOW
        let updatedRejectionLog = false;
        let waitDurationStr = formatShiftDuration(appointment.createdAt, now);

        for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
            const logItem = appointment.treatmentHistory[i];
            if (
                logItem &&
                logItem.toDoctorId &&
                String(logItem.toDoctorId) === String(doctorId) &&
                !logItem.endTime
            ) {
                waitDurationStr = formatShiftDuration(logItem.assignedAt || logItem.startTime || logItem.timestamp, now);
                logItem.action = 'Transfer-Rejected';
                logItem.acceptanceStatus = 'Rejected-By-Doctor';
                logItem.endTime = now;
                logItem.unacceptedWaitDuration = waitDurationStr;
                logItem.rejectionReason = cleanReason;
                logItem.durationDisplay = `Declined after ${waitDurationStr} (Reason: ${cleanReason})`;
                logItem.notes = `${logItem.notes || ''} | [Declined by ${req.user.name} after ${waitDurationStr}: ${cleanReason}]`;
                updatedRejectionLog = true;
                break;
            }
        }

        if (!updatedRejectionLog) {
            appointment.treatmentHistory.push({
                fromDoctorId: isPendingHandover ? (appointment.doctorId || null) : null,
                toDoctorId: doctorId,
                action: 'Transfer-Rejected',
                acceptanceStatus: 'Rejected-By-Doctor',
                assignedAt: appointment.createdAt || now,
                acceptedAt: null,
                endTime: now,
                unacceptedWaitDuration: waitDurationStr,
                rejectionReason: cleanReason,
                durationDisplay: `Declined after ${waitDurationStr} (Reason: ${cleanReason})`,
                notes: `Declined by ${req.user.name}. Reason: ${cleanReason}`,
                timestamp: now,
                startTime: appointment.createdAt || now
            });
        }

        if (isPendingHandover) {
            appointment.pendingDoctorId = null;
        } else if (isCurrentDoctor) {
            appointment.doctorId = null;
            if (['Pending', 'Confirmed'].includes(appointment.status)) {
                appointment.status = 'Clinic-Pending';
            }
        }

        appointment.doctorAcceptanceStatus = 'Rejected';
        appointment.doctorRejectionReason = cleanReason;
        appointment.doctorRespondedAt = now;

        await appointment.save();

        const populatedAppointment = await Appointment.findById(appointment._id)
            .populate('doctorId', 'name speciality qualification profileImage phone dutyStatus')
            .populate('clinicId', 'name clinicName city address')
            .populate('userId', 'name phone email')
            .lean();

        return res.status(200).json({
            success: true,
            action: 'Rejected',
            doctorAcceptanceStatus: 'Rejected',
            rejectionReason: cleanReason,
            message: `Appointment #${appointment.bookingId} rejected and returned to Clinic for reassignment.`,
            data: populatedAppointment
        });

    } catch (error) {
        console.error("Respond To Assigned Appointment Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ==========================================
// 4. START OPD CONSULTATION (Enforces Single Active Token & Alerts Current + Next Token)
// ==========================================
const startClinicConsultation = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            doctorId,
            ...(clinicId ? { clinicId } : {})
        }).populate('userId', 'name phone');

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const blockedStatuses = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'];
        if (blockedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot start consultation because appointment is '${appointment.status}'.`
            });
        }

        // Single Active OPD Token Guard: auto-close previous In-Progress OPD token for today
        if (appointment.bookingType === 'Appointment') {
            const dayStart = moment(appointment.appointmentDate || new Date()).startOf('day').toDate();
            const dayEnd = moment(appointment.appointmentDate || new Date()).endOf('day').toDate();
            await Appointment.updateMany(
                {
                    doctorId,
                    ...(clinicId ? { clinicId } : {}),
                    bookingType: 'Appointment',
                    status: 'In-Progress',
                    appointmentDate: { $gte: dayStart, $lte: dayEnd },
                    _id: { $ne: appointment._id }
                },
                { $set: { status: 'Completed', 'clinicalSummary.dischargedAt': new Date() } }
            );
        }

        const now = new Date();
        appointment.status = 'In-Progress';
        appointment.isTokenSkipped = false; // Auto-clear skip flag if started directly


        if (appointment.doctorAcceptanceStatus !== 'Accepted') {
            appointment.doctorAcceptanceStatus = 'Accepted';
            appointment.doctorRespondedAt = appointment.doctorRespondedAt || now;
        }

        await appointment.save();

        const cabinLabel = appointment.opdRoomNumber || req.user.cabinNumber || "OPD Cabin";
        if (appointment.userId?._id) {
            const tokenTag = appointment.formattedToken ? `Token #${appointment.formattedToken}` : `Appointment #${appointment.bookingId}`;
            sendPushNotification(
                appointment.userId._id,
                'user',
                `Your Turn! ${tokenTag}`,
                `${req.user.name} is ready to see you in ${cabinLabel}. Please proceed inside.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
                    formattedToken: String(appointment.formattedToken || ""),
                    type: "CLINIC_CONSULTATION_STARTED"
                }
            ).catch(() => {});
        }

        // Alert Next Waiting Token if OPD
        if (appointment.bookingType === 'Appointment' && appointment.tokenNumber) {
            const dayStart = moment(appointment.appointmentDate || new Date()).startOf('day').toDate();
            const dayEnd = moment(appointment.appointmentDate || new Date()).endOf('day').toDate();

            const nextWaiting = await Appointment.findOne({
                doctorId,
                ...(clinicId ? { clinicId } : {}),
                bookingType: 'Appointment',
                status: { $in: ['Confirmed', 'Pending', 'Clinic-Pending'] },
                tokenNumber: { $gt: appointment.tokenNumber },
                isTokenSkipped: { $ne: true },
                appointmentDate: { $gte: dayStart, $lte: dayEnd }
            })
                .sort({ tokenNumber: 1 })
                .select('_id bookingId userId formattedToken tokenIntervalMinutes')
                .lean();

            if (nextWaiting?.userId) {
                sendPushNotification(
                    nextWaiting.userId,
                    'user',
                    `Get Ready! Token #${nextWaiting.formattedToken} is Next`,
                    `Token #${appointment.formattedToken} is now in ${cabinLabel}. Your turn (~${nextWaiting.tokenIntervalMinutes || 15} mins) is next.`,
                    {
                        appointmentId: String(nextWaiting._id),
                        formattedToken: String(nextWaiting.formattedToken || ""),
                        type: "OPD_NEXT_TOKEN_ALERT"
                    }
                ).catch(() => {});
            }
        }

        return res.status(200).json({
            success: true,
            message: appointment.formattedToken
                ? `Consultation started for Token #${appointment.formattedToken}. Status is now 'In-Progress'.`
                : `Consultation started for appointment #${appointment.bookingId}. Status is now 'In-Progress'.`,
            data: appointment
        });
    } catch (error) {
        console.error("Start Clinic Consultation Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. RECORD / UPDATE PATIENT VITALS (bp, pulse, temp, spo2, notes)
// @route   PATCH /api/clinic/doctor-panel/appointments/:id/vitals
// ==========================================
const recordClinicAppointmentVitals = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const { bp, pulse, temp, spo2, notes } = req.body || {};

        if (bp === undefined && pulse === undefined && temp === undefined && spo2 === undefined && notes === undefined) {
            return res.status(400).json({
                success: false,
                message: "Please provide at least one vital field (bp, pulse, temp, spo2, or notes)."
            });
        }

        // Fixed: Using $and so idQuery.$or is never overwritten
        const appointment = await Appointment.findOne({
            $and: [
                idQuery,
                ...(clinicId ? [{ clinicId }] : []),
                {
                    $or: [
                        { doctorId },
                        { 'bedsideCareTeam.doctorId': doctorId }
                    ]
                }
            ]
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const closedStatuses = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'];
        if (closedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot update vitals because appointment is '${appointment.status}'.`
            });
        }

        const existingVitals = appointment.clinicalSummary?.vitals || {};
        const recordedVitals = {
            bp: bp !== undefined ? String(bp).trim() : (existingVitals.bp || ""),
            pulse: pulse !== undefined ? String(pulse).trim() : (existingVitals.pulse || ""),
            temp: temp !== undefined ? String(temp).trim() : (existingVitals.temp || ""),
            spo2: spo2 !== undefined ? String(spo2).trim() : (existingVitals.spo2 || ""),
            notes: notes !== undefined ? String(notes).trim() : (existingVitals.notes || ""),
            recordedAt: new Date(),
            recordedBy: doctorId
        };

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.vitals = recordedVitals;

        if (notes && String(notes).trim() !== "") {
            appointment.clinicalSummary.admissionNote = `[Vitals Log]: ${String(notes).trim()}`;
        }

        await appointment.save();

        return res.status(200).json({
            success: true,
            message: `Vitals recorded successfully for appointment #${appointment.bookingId}.`,
            vitals: recordedVitals,
            data: appointment
        });
    } catch (error) {
        console.error("Record Clinic Appointment Vitals Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 6. GET ALL MEDICINES FROM DATABASE (With Optional Clinic Pharmacy Stock Badge)
// @route   GET /api/clinic/doctor-panel/appointments/medicines
// ==========================================
const getClinicDoctorMedicines = async (req, res) => {
    try {
        const clinicId = req.user.clinicId || null;
        const { search = '', page = 1, limit = 50, all = 'false' } = req.query;

        const cleanSearch = String(search || '').trim();
        const fetchAll = all === 'true' || String(limit).toLowerCase() === 'all';
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 50);
        const skip = (pageNum - 1) * limitNum;

        // 1. Query ALL medicines directly from Master Medicine DB Collection
        const masterQuery = {};
        if (cleanSearch) {
            const regex = new RegExp(cleanSearch, 'i');
            masterQuery.$or = [
                { name: regex },
                { salt_composition: regex },
                { primary_use: regex },
                { manufacturers: regex }
            ];
        }

        const totalDocs = await Medicine.countDocuments(masterQuery);

        let medQuery = Medicine.find(masterQuery)
            .select('name salt_composition manufacturers packaging mrp best_price prescription_required image_url primary_use')
            .sort({ name: 1 });

        if (!fetchAll) {
            medQuery = medQuery.skip(skip).limit(limitNum);
        }

        const medicines = await medQuery.lean();

        // 2. Check Clinic Pharmacy only to attach stock/price metadata (Never filters out DB medicines)
        const clinicPharmacy = clinicId
            ? await Pharmacy.findOne({ clinicId, isClinic: true, isActive: true })
                .select('_id name phone address')
                .lean()
            : null;

        let inventoryByMedicineId = new Map();
        if (clinicPharmacy && medicines.length > 0) {
            const medicineIds = medicines.map((m) => m._id);
            const invItems = await MedicineInventory.find({
                pharmacyId: clinicPharmacy._id,
                medicineId: { $in: medicineIds },
                is_available: true,
                stock_quantity: { $gt: 0 }
            }).lean();

            invItems.forEach((inv) => {
                inventoryByMedicineId.set(String(inv.medicineId), inv);
            });
        }

        // 3. Format All DB Medicines
        const formattedMedicines = medicines.map((med) => {
            const inv = inventoryByMedicineId.get(String(med._id)) || null;
            return {
                _id: med._id,
                inventoryId: inv ? inv._id : null,
                name: med.name || "",
                saltComposition: med.salt_composition || "",
                manufacturers: med.manufacturers || "",
                packaging: med.packaging || "1 Strip",
                primaryUse: med.primary_use || "",
                prescriptionRequired: med.prescription_required || "No",
                mrp: Number(inv?.mrp || med.mrp || 0),
                sellingPrice: Number(inv?.vendor_price || inv?.mrp || med.best_price || med.mrp || 0),
                stockQuantity: inv ? (inv.stock_quantity || 0) : 0,
                batchNumber: inv ? inv.batch_number : null,
                expiryDate: inv ? (inv.expiry_date || null) : null,
                imageUrl: Array.isArray(med.image_url) && med.image_url.length > 0 ? med.image_url[0] : null,
                inClinicPharmacy: Boolean(inv)
            };
        });

        return res.status(200).json({
            success: true,
            hasClinicPharmacy: Boolean(clinicPharmacy),
            clinicPharmacy,
            totalDocs,
            totalPages: fetchAll ? 1 : (Math.ceil(totalDocs / limitNum) || 1),
            currentPage: fetchAll ? 1 : pageNum,
            count: formattedMedicines.length,
            data: formattedMedicines
        });
    } catch (error) {
        console.error("Get Clinic Doctor Medicines Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 7. GET ALL LAB TESTS & PACKAGES FROM DATABASE (Clinic Lab + ALL Master DB Tests & Packages)
// @route   GET /api/clinic/doctor-panel/appointments/lab-tests
// ==========================================
const getClinicDoctorLabTests = async (req, res) => {
    try {
        const clinicId = req.user.clinicId || null;
        const { search = '', category = '' } = req.query;

        const cleanSearch = String(search || '').trim();
        const cleanCategory = String(category || '').trim();

        const clinicLab = clinicId
            ? await Lab.findOne({ clinicId, isClinic: true, isActive: { $ne: false } })
                .select('_id name phone address isHomeCollectionAvailable isRapidServiceAvailable')
                .lean()
            : null;

        let clinicTests = [];
        let clinicPackages = [];
        const coveredMasterTestIds = [];
        const coveredMasterPackageIds = [];

        if (clinicLab) {
            const testQuery = { labId: clinicLab._id, isActive: { $ne: false } };
            const pkgQuery = { labId: clinicLab._id, isActive: { $ne: false } };

            if (cleanSearch) {
                const regex = new RegExp(cleanSearch, 'i');
                testQuery.$or = [{ testName: regex }, { mainCategory: regex }, { description: regex }];
                pkgQuery.$or = [{ packageName: regex }, { category: regex }, { shortDescription: regex }];
            }
            if (cleanCategory) {
                const catRegex = new RegExp(cleanCategory, 'i');
                testQuery.mainCategory = catRegex;
                pkgQuery.category = catRegex;
            }

            const [cTests, cPackages] = await Promise.all([
                LabTest.find(testQuery)
                    .select('_id masterTestId testName mainCategory sampleType testType reportTime amount discountPercent discountPrice precaution description')
                    .sort({ testName: 1 })
                    .lean(),
                LabPackage.find(pkgQuery)
                    .select('_id masterPackageId packageName mainCategory category totalTestsIncluded sampleTypes reportTime mrp discountPercent offerPrice precaution shortDescription isFastingRequired fastingDuration')
                    .sort({ packageName: 1 })
                    .lean()
            ]);

            clinicTests = cTests.map((t) => {
                if (t.masterTestId) coveredMasterTestIds.push(t.masterTestId);
                return {
                    _id: t._id,
                    masterTestId: t.masterTestId || null,
                    itemType: 'LabTest',
                    name: t.testName,
                    category: t.mainCategory || 'Pathology',
                    sampleType: t.sampleType || "Blood",
                    testType: t.testType || "Both",
                    reportTime: t.reportTime || "24 Hours",
                    mrp: Number(t.amount || 0),
                    price: Number(t.discountPrice || t.amount || 0),
                    precaution: t.precaution || "",
                    inClinicLab: true
                };
            });

            clinicPackages = cPackages.map((p) => {
                if (p.masterPackageId) coveredMasterPackageIds.push(p.masterPackageId);
                return {
                    _id: p._id,
                    masterPackageId: p.masterPackageId || null,
                    itemType: 'LabPackage',
                    name: p.packageName,
                    category: p.category || p.mainCategory || 'Full Body',
                    totalTestsIncluded: p.totalTestsIncluded || 0,
                    sampleTypes: p.sampleTypes || [],
                    reportTime: p.reportTime || "24 Hours",
                    isFastingRequired: Boolean(p.isFastingRequired),
                    fastingDuration: p.fastingDuration || "",
                    mrp: Number(p.mrp || 0),
                    price: Number(p.offerPrice || p.mrp || 0),
                    precaution: p.precaution || "",
                    inClinicLab: true
                };
            });
        }

        // Fetch ALL Master Tests & Packages from DB (even if not in Clinic Lab inventory)
        const masterTestQuery = {
            isActive: { $ne: false },
            ...(coveredMasterTestIds.length > 0 ? { _id: { $nin: coveredMasterTestIds } } : {})
        };
        const masterPkgQuery = {
            isActive: { $ne: false },
            ...(coveredMasterPackageIds.length > 0 ? { _id: { $nin: coveredMasterPackageIds } } : {})
        };

        if (cleanSearch) {
            const regex = new RegExp(cleanSearch, 'i');
            masterTestQuery.$or = [{ testName: regex }, { mainCategory: regex }, { category: regex }, { testCode: regex }];
            masterPkgQuery.$or = [{ packageName: regex }, { mainCategory: regex }, { category: regex }, { shortDescription: regex }];
        }
        if (cleanCategory) {
            const catRegex = new RegExp(cleanCategory, 'i');
            masterTestQuery.mainCategory = catRegex;
            masterPkgQuery.category = catRegex;
        }

        const [masterTests, masterPackages] = await Promise.all([
            MasterLabTest.find(masterTestQuery)
                .select('_id testName testCode mainCategory category sampleType pretestPreparation standardMRP')
                .sort({ testName: 1 })
                .lean(),
            MasterLabPackage.find(masterPkgQuery)
                .select('_id packageName mainCategory category tests sampleTypes reportTime isFastingRequired fastingDuration preparations standardMRP')
                .sort({ packageName: 1 })
                .lean()
        ]);

        const formattedMasterTests = masterTests.map((mt) => ({
            _id: mt._id,
            masterTestId: mt._id,
            itemType: 'LabTest',
            name: mt.testName,
            category: mt.mainCategory || mt.category || 'Pathology',
            sampleType: mt.sampleType || "Blood",
            testType: "Both",
            reportTime: "24 Hours",
            mrp: Number(mt.standardMRP || 0),
            price: Number(mt.standardMRP || 0),
            precaution: mt.pretestPreparation || "",
            inClinicLab: false
        }));

        const formattedMasterPackages = masterPackages.map((mp) => ({
            _id: mp._id,
            masterPackageId: mp._id,
            itemType: 'LabPackage',
            name: mp.packageName,
            category: mp.category || mp.mainCategory || 'Full Body',
            totalTestsIncluded: Array.isArray(mp.tests) ? mp.tests.length : 0,
            sampleTypes: mp.sampleTypes || [],
            reportTime: mp.reportTime || "24 Hours",
            isFastingRequired: Boolean(mp.isFastingRequired),
            fastingDuration: mp.fastingDuration || "",
            mrp: Number(mp.standardMRP || 0),
            price: Number(mp.standardMRP || 0),
            precaution: Array.isArray(mp.preparations) ? mp.preparations.join(', ') : "",
            inClinicLab: false
        }));

        const allTests = [...clinicTests, ...formattedMasterTests];
        const allPackages = [...clinicPackages, ...formattedMasterPackages];

        return res.status(200).json({
            success: true,
            hasClinicLab: Boolean(clinicLab),
            clinicLab,
            testsCount: allTests.length,
            packagesCount: allPackages.length,
            tests: allTests,
            packages: allPackages
        });
    } catch (error) {
        console.error("Get Clinic Doctor Lab Tests Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 8. PRESCRIBE PATIENT IN OPD (Proper Medicine Doses, Time Schedule & doctorSuggestions)
// @route   POST /api/clinic/doctor-panel/appointments/:id/prescribe
// ==========================================
const prescribeClinicAppointment = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const targetId = req.params.id || req.body?.appointmentId || req.body?.bookingId;

        const idQuery = buildAppointmentIdQuery(targetId);
        if (!idQuery) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            doctorId,
            ...(clinicId ? { clinicId } : {})
        }).populate('userId', 'name phone');

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const closedStatuses = ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'];
        if (closedStatuses.includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot prescribe because appointment is '${appointment.status}'.`
            });
        }

        const {
            chiefComplaints,
            diagnosis,
            medicines,
            doctorSuggestions,
            advisedInvestigations,
            suggestions,
            adviceGiven,
            advice,
            specialInstructions,
            nextAppointment,
            additionalNotes,
            vitals,
            markCompleted = false
        } = req.body || {};

        let rawMedicines = [];
        if (typeof medicines === 'string') {
            try { rawMedicines = JSON.parse(medicines); } catch (e) { rawMedicines = []; }
        } else if (Array.isArray(medicines)) {
            rawMedicines = medicines;
        }

        const parsedMedicines = rawMedicines
            .filter((m) => m && (m.name || m.medicineName))
            .map((m) => parseMedicineDoseAndSchedule(m));

        let parsedDiagnosis = [];
        if (typeof diagnosis === 'string') {
            try {
                const parsed = JSON.parse(diagnosis);
                parsedDiagnosis = Array.isArray(parsed) ? parsed : [String(parsed)];
            } catch (e) {
                parsedDiagnosis = diagnosis.split(',').map((d) => d.trim()).filter(Boolean);
            }
        } else if (Array.isArray(diagnosis)) {
            parsedDiagnosis = diagnosis.map((d) => String(d).trim()).filter(Boolean);
        }

        let parsedVitals = null;
        if (vitals) {
            let vObj = vitals;
            if (typeof vitals === 'string') {
                try { vObj = JSON.parse(vitals); } catch (e) { vObj = null; }
            }
            if (vObj && typeof vObj === 'object') {
                parsedVitals = {
                    bp: vObj.bp ? String(vObj.bp).trim() : (appointment.clinicalSummary?.vitals?.bp || ""),
                    pulse: vObj.pulse ? String(vObj.pulse).trim() : (appointment.clinicalSummary?.vitals?.pulse || ""),
                    temp: vObj.temp ? String(vObj.temp).trim() : (appointment.clinicalSummary?.vitals?.temp || ""),
                    spo2: vObj.spo2 ? String(vObj.spo2).trim() : (appointment.clinicalSummary?.vitals?.spo2 || ""),
                    notes: vObj.notes ? String(vObj.notes).trim() : (appointment.clinicalSummary?.vitals?.notes || ""),
                    recordedAt: new Date(),
                    recordedBy: doctorId
                };
            }
        }

        let prescriptionPdfPath = null;
        if (req.file) {
            prescriptionPdfPath = `/uploads/doctor_prescriptions/${req.file.filename}`;
        } else if (req.files && req.files.prescriptionPdf?.[0]) {
            prescriptionPdfPath = `/uploads/doctor_prescriptions/${req.files.prescriptionPdf[0].filename}`;
        }

        const resolvedAdvice = adviceGiven || advice || "";
        const resolvedSuggestions = String(doctorSuggestions || suggestions || advisedInvestigations || "").trim();

        const newPrescription = await Prescription.create({
            appointmentId: appointment._id,
            doctorId,
            userId: appointment.userId._id || appointment.userId,
            chiefComplaints: chiefComplaints || appointment.clinicalSummary?.chiefComplaint || appointment.bookingReason || "",
            diagnosis: parsedDiagnosis,
            vitals: parsedVitals ? {
                bp: parsedVitals.bp,
                pulse: parsedVitals.pulse,
                temp: parsedVitals.temp,
                spo2: parsedVitals.spo2
            } : {
                bp: appointment.clinicalSummary?.vitals?.bp || "",
                pulse: appointment.clinicalSummary?.vitals?.pulse || "",
                temp: appointment.clinicalSummary?.vitals?.temp || "",
                spo2: appointment.clinicalSummary?.vitals?.spo2 || ""
            },
            medicines: parsedMedicines,
            advisedInvestigations: String(advisedInvestigations || resolvedSuggestions || "").trim(),
            doctorSuggestions: resolvedSuggestions,
            adviceGiven: resolvedAdvice,
            specialInstructions: specialInstructions || "",
            nextAppointment: nextAppointment || "",
            pdfUrl: prescriptionPdfPath,
            additionalNotes: additionalNotes || ""
        });

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        if (chiefComplaints) appointment.clinicalSummary.chiefComplaint = chiefComplaints;
        if (parsedDiagnosis.length > 0) appointment.clinicalSummary.diagnosis = parsedDiagnosis.join(', ');
        if (resolvedSuggestions) {
            appointment.clinicalSummary.doctorSuggestions = resolvedSuggestions;
            appointment.clinicalSummary.investigation = advisedInvestigations || resolvedSuggestions;
        }
        if (resolvedAdvice) appointment.clinicalSummary.treatmentResult = resolvedAdvice;
        if (parsedVitals) appointment.clinicalSummary.vitals = parsedVitals;

        appointment.prescriptionId = newPrescription._id;

        const shouldComplete = markCompleted === true || markCompleted === 'true';
        if (shouldComplete) {
            appointment.status = 'Completed';
            appointment.clinicalSummary.dischargedAt = new Date();
        } else if (['Pending', 'Clinic-Pending', 'Confirmed'].includes(appointment.status)) {
            appointment.status = 'In-Progress';
        }

        await appointment.save();

        if (appointment.userId?._id) {
            sendPushNotification(
                appointment.userId._id,
                'user',
                "Prescription Added",
                `${req.user.name} has added your prescription for appointment #${appointment.bookingId}.`,
                {
                    appointmentId: String(appointment._id),
                    prescriptionId: String(newPrescription._id),
                    type: "CLINIC_PRESCRIPTION_ADDED"
                }
            ).catch(() => {});
        }

        return res.status(201).json({
            success: true,
            message: shouldComplete
                ? `Prescription saved and appointment #${appointment.bookingId} marked Completed.`
                : `Prescription saved for appointment #${appointment.bookingId}. You can now send to Pharmacy, Lab, Admission, or Secondary Doctor.`,
            prescriptionId: newPrescription._id,
            data: {
                prescription: newPrescription,
                appointment
            }
        });
    } catch (error) {
        console.error("Prescribe Clinic Appointment Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 9. SEND PRESCRIBED MEDICINES TO CLINIC PHARMACY (Direct Read-Only Display — No Accept/Reject)
// @route   POST /api/clinic/doctor-panel/appointments/:id/send-to-pharmacy
// ==========================================
const sendAppointmentToClinicPharmacy = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const { medicines, notes = "", prescriptionId, pharmacyId } = req.body || {};

        let rawMedicines = medicines;
        if (typeof medicines === 'string') {
            try { rawMedicines = JSON.parse(medicines); } catch (e) { rawMedicines = []; }
        }

        if (!Array.isArray(rawMedicines) || rawMedicines.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one medicine is required to send to Clinic Pharmacy."
            });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            doctorId,
            ...(clinicId ? { clinicId } : {})
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const pharmacyFilter = pharmacyId && mongoose.Types.ObjectId.isValid(pharmacyId)
            ? { _id: pharmacyId, ...(clinicId ? { clinicId } : {}), isActive: true }
            : { clinicId, isClinic: true, isActive: true };

        const clinicPharmacy = clinicId
            ? await Pharmacy.findOne(pharmacyFilter).select('_id name phone address').lean()
            : null;

        const formattedMedicines = [];
        for (const item of rawMedicines) {
            if (!item) continue;
            let medDoc = null;
            let invDoc = null;

            if (item.medicineId && mongoose.Types.ObjectId.isValid(item.medicineId)) {
                medDoc = await Medicine.findById(item.medicineId)
                    .select('name salt_composition packaging best_price mrp')
                    .lean();
                if (clinicPharmacy) {
                    invDoc = await MedicineInventory.findOne({
                        pharmacyId: clinicPharmacy._id,
                        medicineId: item.medicineId,
                        is_available: true
                    }).lean();
                }
            }

            const structured = parseMedicineDoseAndSchedule({
                ...item,
                name: item.name || item.medicineName || medDoc?.name || ""
            });
            if (!structured.name) continue;

            formattedMedicines.push({
                medicineId: medDoc?._id || structured.medicineId,
                name: structured.name,
                saltComposition: item.saltComposition || medDoc?.salt_composition || structured.genericComposition || "",
                packaging: item.packaging || medDoc?.packaging || "",
                strength: structured.strength,
                dose: structured.dose,
                doseInterval: structured.doseInterval,
                frequency: structured.frequency,
                duration: structured.duration,
                quantity: Math.max(1, Number(item.quantity) || 1),
                dispenseQuantity: structured.dispenseQuantity,
                administrationTiming: structured.administrationTiming,
                instructions: structured.instructions,
                timeSchedule: structured.timeSchedule,
                unitPrice: Number(item.unitPrice || invDoc?.vendor_price || invDoc?.mrp || medDoc?.best_price || medDoc?.mrp || 0)
            });
        }

        if (formattedMedicines.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Valid medicine entries with names are required."
            });
        }

        const now = new Date();
        appointment.clinicPharmacyReferral = {
            pharmacyId: clinicPharmacy?._id || null,
            prescriptionId: prescriptionId || appointment.prescriptionId || null,
            medicines: formattedMedicines,
            notes: String(notes || "").trim(),
            status: 'Sent',
            sentAt: now,
            sentBy: doctorId
        };

        await appointment.save();

        Promise.allSettled([
            clinicPharmacy?._id
                ? sendPushNotification(
                    clinicPharmacy._id,
                    'pharmacy',
                    "New Doctor Pharmacy Prescription",
                    `${req.user.name} sent ${formattedMedicines.length} prescribed medicine(s) for appointment #${appointment.bookingId}.`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
                        type: "CLINIC_DOCTOR_PHARMACY_REFERRAL"
                    }
                )
                : Promise.resolve(),
            appointment.userId
                ? sendPushNotification(
                    appointment.userId,
                    'user',
                    "Collect Medicines from Clinic Pharmacy",
                    `${req.user.name} has sent your prescribed medicines (${formattedMedicines.length}) to ${clinicPharmacy?.name || 'Clinic Pharmacy'}.`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
                        type: "USER_PHARMACY_REFERRAL"
                    }
                )
                : Promise.resolve()
        ]).catch(() => {});

        return res.status(200).json({
            success: true,
            message: `Prescribed medicines sent to ${clinicPharmacy?.name || 'Clinic Pharmacy'} successfully.`,
            data: appointment.clinicPharmacyReferral
        });
    } catch (error) {
        console.error("Send To Clinic Pharmacy Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 10. SEND PRESCRIBED TESTS TO CLINIC LAB (Direct Read-Only Display — No Accept/Reject)
// @route   POST /api/clinic/doctor-panel/appointments/:id/send-to-lab
// ==========================================
const sendAppointmentToClinicLab = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const { tests, notes = "", priority = 'Routine', labId } = req.body || {};

        let rawTests = tests;
        if (typeof tests === 'string') {
            try { rawTests = JSON.parse(tests); } catch (e) { rawTests = []; }
        }

        if (!Array.isArray(rawTests) || rawTests.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one test or package is required to send to Clinic Lab."
            });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            doctorId,
            ...(clinicId ? { clinicId } : {})
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const labFilter = labId && mongoose.Types.ObjectId.isValid(labId)
            ? { _id: labId, ...(clinicId ? { clinicId } : {}), isActive: true }
            : { clinicId, isClinic: true, isActive: true };

        const clinicLab = clinicId
            ? await Lab.findOne(labFilter).select('_id name phone').lean()
            : null;

        const formattedTests = [];
        for (const item of rawTests) {
            if (!item) continue;

            if (item.packageId && mongoose.Types.ObjectId.isValid(item.packageId)) {
                const pkg = await LabPackage.findById(item.packageId).select('packageName offerPrice mrp').lean();
                const masterPkg = !pkg
                    ? await MasterLabPackage.findById(item.packageId).select('packageName standardMRP').lean()
                    : null;

                formattedTests.push({
                    testId: null,
                    packageId: pkg ? item.packageId : null,
                    itemType: 'LabPackage',
                    name: String(item.name || pkg?.packageName || masterPkg?.packageName || "Lab Package").trim(),
                    price: Number(item.price || pkg?.offerPrice || pkg?.mrp || masterPkg?.standardMRP || 0),
                    instructions: String(item.instructions || "").trim()
                });
            } else if (item.testId && mongoose.Types.ObjectId.isValid(item.testId)) {
                const testDoc = await LabTest.findById(item.testId).select('testName discountPrice amount').lean();
                const masterTest = !testDoc
                    ? await MasterLabTest.findById(item.testId).select('testName standardMRP').lean()
                    : null;

                formattedTests.push({
                    testId: testDoc ? item.testId : null,
                    packageId: null,
                    itemType: 'LabTest',
                    name: String(item.name || testDoc?.testName || masterTest?.testName || "Lab Test").trim(),
                    price: Number(item.price || testDoc?.discountPrice || testDoc?.amount || masterTest?.standardMRP || 0),
                    instructions: String(item.instructions || "").trim()
                });
            } else if (item.name && String(item.name).trim() !== "") {
                formattedTests.push({
                    testId: null,
                    packageId: null,
                    itemType: 'Manual',
                    name: String(item.name).trim(),
                    price: Number(item.price || 0),
                    instructions: String(item.instructions || "").trim()
                });
            }
        }

        if (formattedTests.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Valid lab test or package entries are required."
            });
        }

        const allowedPriorities = ['Routine', 'Urgent', 'Emergency'];
        const cleanPriority = allowedPriorities.includes(priority) ? priority : 'Routine';
        const now = new Date();

        appointment.clinicLabReferral = {
            labId: clinicLab?._id || null,
            tests: formattedTests,
            notes: String(notes || "").trim(),
            priority: cleanPriority,
            status: 'Sent',
            sentAt: now,
            sentBy: doctorId
        };

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.investigation = formattedTests.map((t) => t.name).join(', ');

        await appointment.save();

        Promise.allSettled([
            clinicLab?._id
                ? sendPushNotification(
                    clinicLab._id,
                    'lab',
                    "New Lab Test Referral from Doctor",
                    `${req.user.name} referred ${formattedTests.length} test(s) for appointment #${appointment.bookingId} (${cleanPriority}).`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
                        type: "CLINIC_DOCTOR_LAB_REFERRAL"
                    }
                )
                : Promise.resolve(),
            appointment.userId
                ? sendPushNotification(
                    appointment.userId,
                    'user',
                    "Lab Tests Advised",
                    `${req.user.name} has advised ${formattedTests.length} lab test(s) at ${clinicLab?.name || 'Clinic Lab'}.`,
                    {
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId || ""),
                        type: "USER_LAB_REFERRAL"
                    }
                )
                : Promise.resolve()
        ]).catch(() => {});

        return res.status(200).json({
            success: true,
            message: `Lab tests sent to ${clinicLab?.name || 'Clinic Lab'} successfully.`,
            data: appointment.clinicLabReferral
        });
    } catch (error) {
        console.error("Send To Clinic Lab Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 11. GET AVAILABLE CLINIC WARDS & BEDS FOR ADMISSION (With Auto-Release & Hold Duration)
// @route   GET /api/clinic/doctor-panel/appointments/available-beds
// ==========================================
const getClinicDoctorAvailableBeds = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        if (!clinicId) {
            return res.status(400).json({
                success: false,
                message: "Doctor is not linked to any clinic."
            });
        }

        // Release any expired 10/20/30-min bed holds first
        await syncClinicWardAndBedCapacity(clinicId);

        const [clinic, wards, beds] = await Promise.all([
            Clinic.findById(clinicId).select('bedHoldDurationMinutes').lean(),
            Ward.find({ clinicId, isActive: true }).sort({ name: 1 }).lean(),
            Bed.find({ clinicId, status: 'Available' }).sort({ bedNumber: 1 }).lean()
        ]);

        const wardsWithBeds = wards.map((ward) => {
            const availableBedsList = beds
                .filter((b) => String(b.wardId) === String(ward._id))
                .map((b) => ({
                    _id: b._id,
                    bedNumber: b.bedNumber,
                    status: b.status,
                    pricePerDay: Number(b.pricePerDay || ward.pricePerDay || 0),
                    isVentilatorAvailable: Boolean(b.isVentilatorAvailable)
                }));

            return {
                _id: ward._id,
                name: ward.name,
                type: ward.type,
                totalBeds: ward.totalBeds,
                availableBeds: availableBedsList.length,
                pricePerDay: ward.pricePerDay || 0,
                availableBedsList
            };
        });

        return res.status(200).json({
            success: true,
            bedHoldDurationMinutes: Number(clinic?.bedHoldDurationMinutes || 30),
            totalAvailableBeds: beds.length,
            count: wardsWithBeds.length,
            data: wardsWithBeds
        });
    } catch (error) {
        console.error("Get Clinic Doctor Available Beds Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 12. INITIATE OPD-TO-IPD BED HOLD (Configurable 10/20/30-Min Hold + Price Multiplied by Stay Days)
// @route   POST /api/clinic/doctor-panel/appointments/:id/refer-admission
// ==========================================
const referAppointmentToAdmission = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        if (!clinicId) {
            return res.status(400).json({ success: false, message: "Doctor is not linked to any clinic." });
        }

        const {
            bedId = null,
            wardType = 'Daycare',
            stayDuration = 1,
            triageLevel = 'Urgent',
            bookingReason = "",
            reason = "",
            notes = ""
        } = req.body || {};

        // Release expired holds first
        await syncClinicWardAndBedCapacity(clinicId);

        const [parentAppt, clinic] = await Promise.all([
            Appointment.findOne({ $and: [idQuery, { clinicId }, { doctorId }] }),
            Clinic.findById(clinicId).select('bedHoldDurationMinutes clinicName name').lean()
        ]);

        if (!parentAppt) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        const now = new Date();
        const days = Math.max(1, parseInt(stayDuration, 10) || 1);
        const allowedTriage = ['Emergency', 'Very Urgent', 'Urgent', 'Routine'];
        const cleanTriage = allowedTriage.includes(triageLevel) ? triageLevel : 'Urgent';
        const clinicalReason = String(bookingReason || reason || notes || `Admitted from OPD #${parentAppt.bookingId}`).trim();
        const holdMinutes = Math.max(5, Number(clinic?.bedHoldDurationMinutes || 30));
        const holdExpiresAt = new Date(now.getTime() + holdMinutes * 60 * 1000);

        if (bedId) {
            if (!mongoose.Types.ObjectId.isValid(bedId)) {
                return res.status(400).json({ success: false, message: "Invalid bedId format." });
            }

            // Check if an active IPD bed hold already exists for this OPD appointment
            const existingHold = await Appointment.findOne({
                opdAppointmentId: parentAppt._id,
                bookingType: 'Admission',
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Clinic', 'Cancelled-By-Doctor', 'No-Show'] }
            });

            if (existingHold) {
                return res.status(400).json({
                    success: false,
                    message: `An IPD admission (#${existingHold.bookingId}) is already initiated for this OPD visit.`
                });
            }

            const targetBed = await Bed.findOne({ _id: bedId, clinicId }).populate('wardId');
            if (!targetBed || targetBed.status !== 'Available') {
                return res.status(400).json({
                    success: false,
                    message: "Selected bed is currently not available. Please choose another bed."
                });
            }

            const wardTitle = targetBed.wardId?.name || "Clinic Ward";
            const bedPerDay = Number(targetBed.pricePerDay || targetBed.wardId?.pricePerDay || 500);
            const depositAmount = bedPerDay * days; // Multiplied by stayDuration days
            const admissionBookingId = `CLN-ADM-${Math.floor(100000 + Math.random() * 900000)}`;

            const newAdmission = await Appointment.create({
                userId: parentAppt.userId,
                clinicId,
                doctorId,
                doctorAcceptanceStatus: 'Accepted',
                doctorRespondedAt: now,
                wardId: targetBed.wardId?._id || null,
                bedId: targetBed._id,
                opdAppointmentId: parentAppt._id,
                prescriptionId: parentAppt.prescriptionId || null,
                bookingType: 'Admission',
                bedBookingType: cleanTriage === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
                bookingId: admissionBookingId,
                bookingReason: clinicalReason,
                triageLevel: cleanTriage,
                wardName: wardTitle,
                bedNumber: targetBed.bedNumber,
                stayDuration: days,
                startDate: now,
                endDate: moment(now).add(days, 'days').toDate(),
                appointmentDate: now,
                admissionHoldExpiresAt: holdExpiresAt,
                admissionHoldMinutes: holdMinutes,
                patients: parentAppt.patients,
                address: parentAppt.address,
                pricingBreakdown: {
                    baseFee: depositAmount,
                    originalBaseFee: depositAmount,
                    visitCharges: depositAmount,
                    extraCharges: 0,
                    discountAmount: 0,
                    subtotal: depositAmount
                },
                totalAmount: depositAmount,
                paymentStatus: 'Pending',
                status: 'Clinic-Pending',
                insuranceDetails: parentAppt.insuranceDetails,
                clinicalSummary: {
                    chiefComplaint: parentAppt.clinicalSummary?.chiefComplaint || "",
                    diagnosis: parentAppt.clinicalSummary?.diagnosis || clinicalReason,
                    doctorSuggestions: parentAppt.clinicalSummary?.doctorSuggestions || "",
                    vitals: parentAppt.clinicalSummary?.vitals || {},
                    admissionNote: notes || clinicalReason
                },
                treatmentHistory: [{
                    fromDoctorId: null,
                    toDoctorId: doctorId,
                    action: 'Initial-Assignment',
                    acceptanceStatus: 'Accepted',
                    assignedAt: now,
                    acceptedAt: now,
                    notes: `${req.user.name} initiated ${holdMinutes}-min bed hold on ${wardTitle} (${targetBed.bedNumber}) for ${days} day(s).`,
                    startTime: now,
                    durationDisplay: "Active Duty"
                }]
            });

            // Lock Bed under Reserved Hold & Sync Ward
            targetBed.status = 'Reserved';
            targetBed.holdExpiresAt = holdExpiresAt;
            targetBed.currentAppointmentId = newAdmission._id;
            await targetBed.save();

            await syncClinicWardAndBedCapacity(clinicId, targetBed.wardId?._id);

            parentAppt.admissionReferral = {
                status: 'Reserved',
                admissionAppointmentId: newAdmission._id,
                wardId: targetBed.wardId?._id || null,
                bedId: targetBed._id,
                wardType: targetBed.wardId?.type || wardType,
                triageLevel: cleanTriage,
                stayDuration: days,
                reason: clinicalReason,
                notes: String(notes || "").trim(),
                referredAt: now,
                referredBy: doctorId
            };
            parentAppt.status = 'Completed';
            await parentAppt.save();

            if (parentAppt.userId) {
                sendPushNotification(
                    parentAppt.userId,
                    'user',
                    `Bed Reserved (${holdMinutes}-Min Hold)`,
                    `${req.user.name} reserved Bed ${targetBed.bedNumber} (${wardTitle}) for ${days} day(s). Please pay ₹${depositAmount} online or at Clinic Reception within ${holdMinutes} minutes.`,
                    {
                        appointmentId: String(newAdmission._id),
                        bookingId: admissionBookingId,
                        depositPayable: String(depositAmount),
                        holdExpiresAt: holdExpiresAt.toISOString(),
                        type: "CLINIC_IPD_ADMISSION_HOLD"
                    }
                ).catch(() => {});
            }

            return res.status(201).json({
                success: true,
                message: `Bed ${targetBed.bedNumber} (${wardTitle}) reserved for ${holdMinutes} minutes! Total deposit for ${days} day(s): ₹${depositAmount}.`,
                bedHoldMinutes: holdMinutes,
                admissionHoldExpiresAt: holdExpiresAt,
                depositPayable: depositAmount,
                data: {
                    admissionReferral: parentAppt.admissionReferral,
                    admissionAppointment: newAdmission
                }
            });
        }

        // Recommendation without specific bed selected
        parentAppt.admissionReferral = {
            status: 'Recommended',
            admissionAppointmentId: null,
            wardId: null,
            bedId: null,
            wardType: String(wardType || 'Daycare').trim(),
            triageLevel: cleanTriage,
            stayDuration: days,
            reason: clinicalReason,
            notes: String(notes || "").trim(),
            referredAt: now,
            referredBy: doctorId
        };
        parentAppt.status = 'Completed';
        await parentAppt.save();

        return res.status(200).json({
            success: true,
            message: "Patient referred for Clinic Admission. Clinic Reception can assign a bed.",
            data: parentAppt.admissionReferral
        });
    } catch (error) {
        console.error("Refer Appointment To Admission Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 13. GET AVAILABLE SECONDARY CLINIC DOCTORS (Excludes Self, Busy, Off Duty, On Leave)
// @route   GET /api/clinic/doctor-panel/appointments/available-doctors
// ==========================================
const getAvailableSecondaryClinicDoctors = async (req, res) => {
    try {
        const currentDoctorId = req.user.id;
        const clinicId = req.user.clinicId;
        const { speciality = '', search = '', appointmentId = '' } = req.query;

        if (!clinicId) {
            return res.status(400).json({
                success: false,
                message: "Doctor is not linked to any clinic."
            });
        }

        const query = {
            clinicId,
            _id: { $ne: currentDoctorId },
            isActive: true,
            profileStatus: 'Approved',
            dutyStatus: { $nin: ['Busy', 'Off Duty', 'On Leave'] }
        };

        if (speciality && String(speciality).trim() !== '') {
            query.speciality = new RegExp(String(speciality).trim(), 'i');
        }

        if (search && String(search).trim() !== '') {
            const regex = new RegExp(String(search).trim(), 'i');
            query.$or = [
                { name: regex },
                { speciality: regex },
                { qualification: regex }
            ];
        }

        let alreadyAddedMap = {};
        if (appointmentId && String(appointmentId).trim() !== '') {
            const apptQuery = buildAppointmentIdQuery(appointmentId);
            const appt = await Appointment.findOne({ ...apptQuery, clinicId })
                .select('bedsideCareTeam')
                .lean();
            if (appt?.bedsideCareTeam) {
                appt.bedsideCareTeam.forEach((m) => {
                    if (m.doctorId) alreadyAddedMap[String(m.doctorId)] = m.status;
                });
            }
        }

        const doctors = await Doctor.find(query)
            .select('_id name profileImage speciality qualification experienceYears gender dutyStatus fees averageRating totalReviews')
            .sort({ averageRating: -1, name: 1 })
            .lean();

        const formattedDoctors = doctors.map((doc) => ({
            ...doc,
            isAlreadyAddedOnCase: Boolean(alreadyAddedMap[String(doc._id)]),
            existingCareTeamStatus: alreadyAddedMap[String(doc._id)] || null
        }));

        return res.status(200).json({
            success: true,
            count: formattedDoctors.length,
            data: formattedDoctors
        });
    } catch (error) {
        console.error("Get Available Secondary Clinic Doctors Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 14. ADD SECONDARY DOCTOR / SEND FOR SECOND OPINION
// @route   POST /api/clinic/doctor-panel/appointments/:id/add-secondary-doctor
// ==========================================
const addSecondaryDoctorOrOpinion = async (req, res) => {
    try {
        const primaryDoctorId = req.user.id;
        const clinicId = req.user.clinicId;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const {
            secondaryDoctorId,
            specialistDoctorId,
            doctorId,
            roleType = 'Secondary-Doctor',
            requestReason = "",
            reason = "",
            patientCondition = "Stable",
            priority = 'Routine'
        } = req.body || {};

        const targetDocId = secondaryDoctorId || specialistDoctorId || doctorId;
        if (!targetDocId || !mongoose.Types.ObjectId.isValid(targetDocId)) {
            return res.status(400).json({
                success: false,
                message: "Valid secondaryDoctorId is required."
            });
        }

        if (String(targetDocId) === String(primaryDoctorId)) {
            return res.status(400).json({
                success: false,
                message: "You cannot add yourself as a secondary doctor."
            });
        }

        const [appointment, targetDoctor] = await Promise.all([
            Appointment.findOne({
                ...idQuery,
                doctorId: primaryDoctorId,
                ...(clinicId ? { clinicId } : {})
            }),
            Doctor.findOne({
                _id: targetDocId,
                ...(clinicId ? { clinicId } : {}),
                isActive: true,
                profileStatus: 'Approved'
            }).select('name speciality dutyStatus')
        ]);

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or you are not the primary doctor for this case."
            });
        }

        if (!targetDoctor) {
            return res.status(404).json({
                success: false,
                message: "Selected secondary doctor not found or not approved in this clinic."
            });
        }

        if (['Busy', 'Off Duty', 'On Leave'].includes(targetDoctor.dutyStatus)) {
            return res.status(400).json({
                success: false,
                message: `${targetDoctor.name} is currently '${targetDoctor.dutyStatus}' and unavailable.`
            });
        }

        if (!Array.isArray(appointment.bedsideCareTeam)) {
            appointment.bedsideCareTeam = [];
        }

        const existingEntry = appointment.bedsideCareTeam.find(
            (m) => m.doctorId && String(m.doctorId) === String(targetDocId)
        );
        if (existingEntry && existingEntry.status !== 'Rejected') {
            return res.status(400).json({
                success: false,
                message: `${targetDoctor.name} is already added to this appointment (Status: ${existingEntry.status}).`
            });
        }

        const cleanRoleType = ['Secondary-Doctor', 'Second-Opinion'].includes(roleType)
            ? roleType
            : 'Secondary-Doctor';
        const cleanPriority = ['Most Urgent', 'Urgent', 'Routine'].includes(priority)
            ? priority
            : 'Routine';
        const finalReason = String(requestReason || reason || "Specialist opinion / secondary consultation requested.").trim();

        const newCareEntry = {
            doctorId: targetDoctor._id,
            roleType: cleanRoleType,
            status: 'Pending',
            requestReason: finalReason,
            patientConditionAtRequest: String(patientCondition || "Stable").trim(),
            priority: cleanPriority,
            requestedAt: new Date()
        };

        if (existingEntry && existingEntry.status === 'Rejected') {
            Object.assign(existingEntry, newCareEntry, { rejectionReason: "" });
        } else {
            appointment.bedsideCareTeam.push(newCareEntry);
        }

        appointment.markModified('bedsideCareTeam');
        await appointment.save();

        const notifTitle = cleanRoleType === 'Second-Opinion'
            ? "Second Opinion Requested"
            : "Added as Secondary Doctor";

        sendPushNotification(
            targetDoctor._id,
            'doctor',
            notifTitle,
            `${req.user.name} requested your ${cleanRoleType === 'Second-Opinion' ? 'opinion' : 'co-consultation'} for #${appointment.bookingId}. Priority: ${cleanPriority}.`,
            {
                appointmentId: String(appointment._id),
                bookingId: String(appointment.bookingId || ""),
                type: "CLINIC_SECONDARY_DOCTOR_REQUEST"
            }
        ).catch(() => {});

        return res.status(201).json({
            success: true,
            message: `${targetDoctor.name} (${cleanRoleType}) added successfully and notified.`,
            data: appointment.bedsideCareTeam
        });
    } catch (error) {
        console.error("Add Secondary Doctor Or Opinion Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 15. SECONDARY DOCTOR RESPONDS TO REQUEST (Accept / Reject)
// @route   PATCH /api/clinic/doctor-panel/appointments/:id/secondary-doctor/respond
// ==========================================
const respondToSecondaryDoctorRequest = async (req, res) => {
    try {
        const secondaryDoctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const rawAction = String(req.body?.action || req.body?.status || '').trim().toLowerCase();
        let cleanStatus = null;
        if (['accept', 'accepted'].includes(rawAction)) cleanStatus = 'Accepted';
        else if (['reject', 'rejected', 'decline', 'declined'].includes(rawAction)) cleanStatus = 'Rejected';

        if (!cleanStatus) {
            return res.status(400).json({
                success: false,
                message: "Valid action ('Accept' or 'Reject') is required."
            });
        }

        const rejectionReason = String(req.body?.rejectionReason || req.body?.reason || '').trim();
        if (cleanStatus === 'Rejected' && !rejectionReason) {
            return res.status(400).json({
                success: false,
                message: "rejectionReason is mandatory when rejecting a secondary consultation request."
            });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            ...(clinicId ? { clinicId } : {}),
            bedsideCareTeam: {
                $elemMatch: {
                    doctorId: new mongoose.Types.ObjectId(secondaryDoctorId),
                    status: 'Pending'
                }
            }
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "No pending secondary doctor / opinion request found for you on this appointment."
            });
        }

        const careEntry = appointment.bedsideCareTeam.find(
            (m) => m.doctorId && String(m.doctorId) === String(secondaryDoctorId)
        );

        careEntry.status = cleanStatus;
        careEntry.respondedAt = new Date();
        if (cleanStatus === 'Rejected') {
            careEntry.rejectionReason = rejectionReason;
        }

        appointment.markModified('bedsideCareTeam');
        await appointment.save();

        if (appointment.doctorId) {
            sendPushNotification(
                appointment.doctorId,
                'doctor',
                `Secondary Doctor ${cleanStatus}`,
                `${req.user.name} ${cleanStatus.toLowerCase()} your consultation request for #${appointment.bookingId}.`,
                {
                    appointmentId: String(appointment._id),
                    type: "SECONDARY_DOCTOR_RESPONDED"
                }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: `Consultation request ${cleanStatus.toLowerCase()} successfully.`,
            data: careEntry
        });
    } catch (error) {
        console.error("Respond To Secondary Doctor Request Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 16. SECONDARY DOCTOR SUBMITS CLINICAL OPINION / FEEDBACK
// @route   POST /api/clinic/doctor-panel/appointments/:id/secondary-doctor/opinion
// ==========================================
const submitSecondaryDoctorOpinion = async (req, res) => {
    try {
        const secondaryDoctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const {
            observation,
            notes,
            patientCondition = "Stable",
            priorityRating = "Routine",
            vitals,
            markCompleted = false
        } = req.body || {};

        const finalObservation = String(observation || notes || "").trim();
        if (!finalObservation) {
            return res.status(400).json({
                success: false,
                message: "Clinical observation or opinion text is required."
            });
        }

        const appointment = await Appointment.findOne({
            ...idQuery,
            ...(clinicId ? { clinicId } : {}),
            bedsideCareTeam: {
                $elemMatch: {
                    doctorId: new mongoose.Types.ObjectId(secondaryDoctorId),
                    status: { $in: ['Accepted', 'In-Progress'] }
                }
            }
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Accepted secondary consultation record not found for you on this appointment."
            });
        }

        const careEntry = appointment.bedsideCareTeam.find(
            (m) => m.doctorId && String(m.doctorId) === String(secondaryDoctorId)
        );

        let parsedVitals = { bp: "", pulse: "", temp: "", spo2: "" };
        if (vitals) {
            let vObj = vitals;
            if (typeof vitals === 'string') {
                try { vObj = JSON.parse(vitals); } catch (e) { vObj = {}; }
            }
            if (vObj && typeof vObj === 'object') {
                parsedVitals = {
                    bp: String(vObj.bp || "").trim(),
                    pulse: String(vObj.pulse || "").trim(),
                    temp: String(vObj.temp || "").trim(),
                    spo2: String(vObj.spo2 || "").trim()
                };
            }
        }

        if (!Array.isArray(careEntry.specialistFeedback)) {
            careEntry.specialistFeedback = [];
        }

        careEntry.specialistFeedback.push({
            observation: finalObservation,
            patientCondition: String(patientCondition || "Stable").trim(),
            priorityRating: String(priorityRating || "Routine").trim(),
            vitals: parsedVitals,
            submittedAt: new Date()
        });

        const shouldComplete = markCompleted === true || markCompleted === 'true';
        careEntry.status = shouldComplete ? 'Completed' : 'In-Progress';

        appointment.markModified('bedsideCareTeam');
        await appointment.save();

        if (appointment.doctorId) {
            sendPushNotification(
                appointment.doctorId,
                'doctor',
                "New Specialist Opinion Added",
                `${req.user.name} submitted an opinion for appointment #${appointment.bookingId}.`,
                {
                    appointmentId: String(appointment._id),
                    type: "SECONDARY_DOCTOR_OPINION_ADDED"
                }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: shouldComplete
                ? "Opinion submitted and secondary consultation marked Completed."
                : "Opinion / clinical feedback submitted successfully.",
            data: careEntry
        });
    } catch (error) {
        console.error("Submit Secondary Doctor Opinion Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 17. COMPLETE CLINIC CONSULTATION (Alerts Next Waiting OPD Token)
// ==========================================
const completeClinicConsultation = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const { consultationNotes = "", advice = "" } = req.body || {};

        const appointment = await Appointment.findOne({
            ...idQuery,
            doctorId,
            ...(clinicId ? { clinicId } : {})
        });

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found or not assigned to you."
            });
        }

        if (appointment.status === 'Completed') {
            return res.status(400).json({
                success: false,
                message: "This appointment is already marked as Completed."
            });
        }

        const now = new Date();
        appointment.status = 'Completed';
        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.dischargedAt = now;

        if (String(consultationNotes).trim() !== "") {
            appointment.clinicalSummary.treatmentResult = String(consultationNotes).trim();
        }
        if (String(advice).trim() !== "") {
            appointment.clinicalSummary.dischargeNote = String(advice).trim();
        }

        if (Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0) {
            const lastShift = appointment.treatmentHistory[appointment.treatmentHistory.length - 1];
            if (lastShift && !lastShift.endTime) {
                lastShift.endTime = now;
                lastShift.acceptanceStatus = 'Completed';
                lastShift.durationDisplay = formatShiftDuration(
                    lastShift.acceptedAt || lastShift.startTime || lastShift.timestamp,
                    now
                );
            }
        }

        await appointment.save();

        if (appointment.userId) {
            sendPushNotification(
                appointment.userId,
                'user',
                "Consultation Completed",
                `Your consultation with ${req.user.name} for #${appointment.bookingId} is completed.`,
                {
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId || ""),
                    type: "CLINIC_CONSULTATION_COMPLETED"
                }
            ).catch(() => {});
        }

        // Alert Next Waiting OPD Token
        let nextWaitingToken = null;
        if (appointment.bookingType === 'Appointment' && appointment.tokenNumber) {
            const dayStart = moment(appointment.appointmentDate || now).startOf('day').toDate();
            const dayEnd = moment(appointment.appointmentDate || now).endOf('day').toDate();

            const nextWaiting = await Appointment.findOne({
                doctorId,
                ...(clinicId ? { clinicId } : {}),
                bookingType: 'Appointment',
                status: { $in: ['Confirmed', 'Pending', 'Clinic-Pending'] },
                tokenNumber: { $gt: appointment.tokenNumber },
                isTokenSkipped: { $ne: true },
                appointmentDate: { $gte: dayStart, $lte: dayEnd }
            })
                .sort({ tokenNumber: 1 })
                .select('_id bookingId userId formattedToken')
                .lean();

            if (nextWaiting) {
                nextWaitingToken = nextWaiting.formattedToken;
                if (nextWaiting.userId) {
                    const cabinLabel = appointment.opdRoomNumber || req.user.cabinNumber || "OPD Cabin";
                    sendPushNotification(
                        nextWaiting.userId,
                        'user',
                        `Your Turn is Next! Token #${nextWaiting.formattedToken}`,
                        `Please proceed towards ${cabinLabel}. ${req.user.name} is wrapping up and will call you next.`,
                        {
                            appointmentId: String(nextWaiting._id),
                            formattedToken: String(nextWaiting.formattedToken || ""),
                            type: "OPD_NEXT_TOKEN_ALERT"
                        }
                    ).catch(() => {});
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: `Appointment #${appointment.bookingId} marked as Completed.`,
            nextWaitingToken,
            data: appointment
        });
    } catch (error) {
        console.error("Complete Clinic Consultation Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 18. OPD DOCTOR REFERS PATIENT TO ANOTHER CLINIC DOCTOR (Creates ReferredToAnotherDoctor for Clinic Reception)
// @route   POST /api/clinic/doctor-panel/appointments/:id/refer-to-doctor
// @access  Private (Clinic Doctor)
// ==========================================
const referToAnotherDoctor = async (req, res) => {
    try {
        const referringDoctorId = req.user.id;
        const clinicId = req.user.clinicId;
        const idQuery = buildAppointmentIdQuery(req.params.id || req.body?.appointmentId);

        if (!idQuery) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        const {
            referredToDoctorId,
            secondaryDoctorId,
            doctorId,
            reason = "",
            clinicalNotes = "",
            priority = 'Routine'
        } = req.body || {};

        const targetDoctorId = referredToDoctorId || secondaryDoctorId || doctorId;
        if (!targetDoctorId || !mongoose.Types.ObjectId.isValid(targetDoctorId)) {
            return res.status(400).json({
                success: false,
                message: "Valid referredToDoctorId is required."
            });
        }

        if (String(targetDoctorId) === String(referringDoctorId)) {
            return res.status(400).json({
                success: false,
                message: "You cannot refer a patient to yourself."
            });
        }

        const [sourceAppt, targetDoctor] = await Promise.all([
            Appointment.findOne({ $and: [idQuery, { doctorId: referringDoctorId }, ...(clinicId ? [{ clinicId }] : [])] }),
            Doctor.findOne({
                _id: targetDoctorId,
                ...(clinicId ? { clinicId } : {}),
                isActive: true,
                profileStatus: 'Approved'
            }).select('name speciality fees cabinNumber')
        ]);

        if (!sourceAppt) {
            return res.status(404).json({
                success: false,
                message: "Source appointment not found or not assigned to you."
            });
        }

        if (!targetDoctor) {
            return res.status(404).json({
                success: false,
                message: "Target doctor not found or not approved in this clinic."
            });
        }

        const allowedPriorities = ['Routine', 'Urgent', 'Emergency'];
        const cleanPriority = allowedPriorities.includes(priority) ? priority : 'Routine';
        const referralCode = `CLN-REF-${Math.floor(100000 + Math.random() * 900000)}`;

        const referralRecord = await ReferredToAnotherDoctor.create({
            referralCode,
            clinicId: sourceAppt.clinicId,
            userId: sourceAppt.userId,
            sourceAppointmentId: sourceAppt._id,
            referredByDoctorId: referringDoctorId,
            prescriptionId: sourceAppt.prescriptionId || null,
            referredToDoctorId: targetDoctor._id,
            reason: String(reason || `Referred by ${req.user.name} for specialist evaluation`).trim(),
            clinicalNotes: String(clinicalNotes || sourceAppt.clinicalSummary?.doctorSuggestions || "").trim(),
            priority: cleanPriority,
            status: 'Pending-Clinic-Booking',
            feeAmount: Number(targetDoctor.fees?.clinic || 0),
            paymentStatus: 'Pending'
        });

        sourceAppt.referralRecordId = referralRecord._id;
        await sourceAppt.save();

        if (sourceAppt.userId) {
            sendPushNotification(
                sourceAppt.userId,
                'user',
                "Referred to Specialist Doctor",
                `${req.user.name} has referred you to ${targetDoctor.name} (${targetDoctor.speciality}). Please visit Clinic Reception to book your referred slot.`,
                {
                    referralId: String(referralRecord._id),
                    referralCode,
                    type: "CLINIC_DOCTOR_REFERRED_PATIENT"
                }
            ).catch(() => {});
        }

        const populatedReferral = await ReferredToAnotherDoctor.findById(referralRecord._id)
            .populate('referredByDoctorId', 'name speciality cabinNumber')
            .populate('referredToDoctorId', 'name speciality fees cabinNumber profileImage')
            .populate('prescriptionId')
            .lean();

        return res.status(201).json({
            success: true,
            message: `Patient referred to ${targetDoctor.name}. Request sent to Clinic Reception for slot booking & payment.`,
            data: populatedReferral
        });
    } catch (error) {
        console.error("Refer To Another Doctor Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById,
    respondToAssignedAppointment,
    startClinicConsultation,
    recordClinicAppointmentVitals,
    getClinicDoctorMedicines,
    getClinicDoctorLabTests,
    prescribeClinicAppointment,
    sendAppointmentToClinicPharmacy,
    sendAppointmentToClinicLab,
    getClinicDoctorAvailableBeds,
    referAppointmentToAdmission,
    getAvailableSecondaryClinicDoctors,
    addSecondaryDoctorOrOpinion,
    respondToSecondaryDoctorRequest,
    submitSecondaryDoctorOpinion,
    completeClinicConsultation,
    referToAnotherDoctor
};