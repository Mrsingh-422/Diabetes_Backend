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
        const startRef = item.startTime || item.timestamp;
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
            isCurrentlyActive: Boolean(!endRef && !isCaseClosed && isLastEntry),
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

            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                bookingType: appt.bookingType,
                categoryTag,
                consultationType: appt.consultationType || 'Clinic Visit',
                status: appt.status,
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
                    lastAction: latestHistory?.action || null,
                    assignedAt: latestHistory?.startTime || latestHistory?.timestamp || appt.createdAt,
                    isPendingHandover: Boolean(appt.pendingDoctorId && appt.pendingDoctorId.toString() === String(doctorId))
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

module.exports = {
    getClinicDoctorAppointments,
    getClinicDoctorAppointmentById
};