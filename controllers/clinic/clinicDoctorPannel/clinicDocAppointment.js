// controllers/clinic/clinicDoctorPannel/clinicDocAppointment.js

const Appointment = require('../../../models/Appointment');
const Doctor = require('../../../models/Doctor');
const Clinic = require('../../../models/Clinic');
const Prescription = require('../../../models/Prescription');
const User = require('../../../models/User');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
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
// Helper 3: Resolve Clean Patient Profile (Removes "Myself (Primary Account)" placeholder)
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
// 1. GET CLINIC DOCTOR APPOINTMENTS LIST (With Filters, Tabs, Date & Search)
// @route   GET /api/clinic/doctor-panel/appointments
// @access  Private (Clinic Doctor)
// ==========================================
const getClinicDoctorAppointments = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;

        const {
            tab = 'all',        // 'all' | 'opd' | 'ipd' | 'emergency' | 'handover' | 'bedside'
            bookingType,        // Optional direct filter: 'Appointment' | 'Admission' | 'Emergency'
            status,             // Optional status or shortcut: 'active' | 'history' | exact status
            date,               // Optional: 'YYYY-MM-DD' | 'today' | 'all'
            search,
            page = 1,
            limit = 20
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (pageNum - 1) * limitNum;

        // 1. Base Ownership Filter
        let query = {};
        if (tab === 'handover') {
            query.pendingDoctorId = doctorId;
        } else if (tab === 'bedside') {
            query['bedsideCareTeam.doctorId'] = doctorId;
        } else {
            query.doctorId = doctorId;
        }

        if (clinicId) {
            query.clinicId = clinicId;
        }

        // 2. Tab / Booking Type Filter
        const normalizedTab = String(tab || 'all').toLowerCase();
        if (bookingType && String(bookingType).trim() !== '') {
            query.bookingType = String(bookingType).trim();
        } else if (normalizedTab === 'opd') {
            query.bookingType = 'Appointment';
        } else if (normalizedTab === 'ipd') {
            query.bookingType = 'Admission';
        } else if (normalizedTab === 'emergency') {
            query.$or = [
                { bookingType: 'Emergency' },
                { triageLevel: 'Emergency' }
            ];
        }

        // 3. Status Filter (Supports shortcuts 'active' & 'history' or exact enum)
        if (status && String(status).trim() !== '') {
            const cleanStatus = String(status).trim();
            if (cleanStatus.toLowerCase() === 'active') {
                query.status = { $in: ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending', 'Rescheduled'] };
            } else if (cleanStatus.toLowerCase() === 'history') {
                query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'] };
            } else {
                query.status = cleanStatus;
            }
        }

        const andConditions = [];

        // 4. Optional Date Filter (When 'today' or 'YYYY-MM-DD' is passed)
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

        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        // 6. Execute Query & Summary Counts
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

        // 7. Format Clean List Items
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

                // Patient Summary
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

                // Ward & Bed Stay (if IPD/Emergency)
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

                // Clinic Summary
                clinic: appt.clinicId ? {
                    _id: appt.clinicId._id,
                    name: appt.clinicId.clinicName || appt.clinicId.name,
                    city: appt.clinicId.city || "",
                    image: appt.clinicId.image || null
                } : null,

                // Payment Summary
                payment: {
                    totalAmount: appt.totalAmount || 0,
                    paymentStatus: appt.paymentStatus || 'Pending',
                    paymentMethod: appt.paymentMethod || appt.paymentDetails?.method || null
                },

                // Shift / Assignment Meta
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
// @access  Private (Clinic Doctor)
// ==========================================
const getClinicDoctorAppointmentById = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const { id } = req.params;

        if (!id || String(id).trim() === '') {
            return res.status(400).json({
                success: false,
                message: "Appointment ID or bookingId is required."
            });
        }

        const cleanId = String(id).trim();
        const idQuery = mongoose.Types.ObjectId.isValid(cleanId)
            ? { $or: [{ _id: cleanId }, { bookingId: cleanId }] }
            : { bookingId: cleanId };

        // Doctor can access if assigned as primary doctor, pending handover target, or bedside care team member
        const accessQuery = {
            ...idQuery,
            ...(clinicId ? { clinicId } : {}),
            $or: [
                { doctorId: doctorId },
                { pendingDoctorId: doctorId },
                { 'bedsideCareTeam.doctorId': doctorId }
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

        // Fetch linked Prescriptions
        const prescriptions = await Prescription.find({ appointmentId: appointment._id })
            .populate('doctorId', 'name speciality qualification signatureImage profileImage')
            .sort({ createdAt: -1 })
            .lean();

        const latestPrescription = prescriptions.length > 0 ? prescriptions[0] : null;

        // Resolve Clean Patient Profile
        const resolvedPatient = resolvePatientProfile(appointment);

        // Enrich Treatment History with Shift Durations
        const enrichedTreatmentHistory = enrichTreatmentHistory(
            appointment.treatmentHistory,
            appointment.status
        );

        // Build Treatment Team Timeline (Primary Physician + Bedside Care Team)
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
                        role: "Bedside Co-Doctor Specialist",
                        status: member.status,
                        priority: member.priority,
                        requestReason: member.requestReason,
                        requestedAt: member.requestedAt,
                        respondedAt: member.respondedAt
                    });
                }
            });
        }

        // Clinical Files Summary
        const clinicalFiles = {
            prescriptionPdf: latestPrescription?.pdfUrl || null,
            dietPlanPdf: latestPrescription?.dietPlanPdf || null,
            dischargeSummaryPdf: appointment.clinicalSummary?.dischargeSummaryPdf || null,
            uploadedReports: appointment.clinicalSummary?.uploadedReports || [],
            insuranceDocument: appointment.insuranceDetails?.insuranceDocument || null
        };

        // Stay & Billing Breakdown
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

        // Doctor Role Permissions for Frontend Actions
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
                    canRespondToAssignment: (isPrimaryDoctor && acceptanceState === 'Pending' || isPendingHandoverTarget) &&
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
// 3. CLINIC DOCTOR ACCEPTS OR REJECTS (WITH REASON) ASSIGNED APPOINTMENT
// @route   PATCH /api/clinic/doctor-panel/appointments/respond
// @route   PATCH /api/clinic/doctor-panel/appointments/:id/respond
// @access  Private (Clinic Doctor)
// ==========================================
const respondToAssignedAppointment = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;

        const targetApptId = req.params.id || req.body?.appointmentId || req.body?.bookingId;
        const rawAction = req.body?.action || req.body?.status;
        const reason = req.body?.reason || req.body?.rejectionReason || req.body?.notes || "";

        if (!targetApptId || String(targetApptId).trim() === '') {
            return res.status(400).json({
                success: false,
                message: "appointmentId (or bookingId) is required."
            });
        }

        // Normalize Action ('Accept' or 'Reject')
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

        // Strict validation: Rejection reason is mandatory when rejecting
        const cleanReason = String(reason || '').trim();
        if (normalizedAction === 'Rejected' && cleanReason === '') {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is mandatory when rejecting an assigned appointment."
            });
        }

        // Locate appointment assigned to this Clinic Doctor (either primary doctorId or handover pendingDoctorId)
        const cleanTarget = String(targetApptId).trim();
        const idFilter = mongoose.Types.ObjectId.isValid(cleanTarget)
            ? { $or: [{ _id: cleanTarget }, { bookingId: cleanTarget }] }
            : { bookingId: cleanTarget };

        const appointment = await Appointment.findOne({
            ...idFilter,
            ...(clinicId ? { clinicId } : {}),
            $or: [
                { doctorId: doctorId },
                { pendingDoctorId: doctorId }
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

        // ==========================================
        // CASE A: DOCTOR ACCEPTS APPOINTMENT
        // ==========================================
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

                // If there is an open assignment log for THIS doctor awaiting acceptance
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
                    // Close previous doctor's active shift if this was a handover
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

            // Notify Patient & Previous Doctor (Non-blocking)
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

        // ==========================================
        // CASE B: DOCTOR REJECTS APPOINTMENT WITH REASON
        // ==========================================
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

        // Clear doctor assignment so Clinic can assign another free doctor
        if (isPendingHandover) {
            appointment.pendingDoctorId = null;
        } else if (isCurrentDoctor) {
            appointment.doctorId = null;
            // Move back to Clinic-Pending unless already active IPD/In-Progress
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

module.exports = {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById,
    respondToAssignedAppointment
};