// controllers/clinic/clinicDoctorPannel/clinicDocCases.js

const Appointment = require('../../../models/Appointment');
const Prescription = require('../../../models/Prescription');
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
// Helper 4: Build Appointment ID Filter (_id or bookingId)
// ==========================================
const buildIdCondition = (idParam) => {
    const cleanId = String(idParam || '').trim();
    if (!cleanId) return null;
    return mongoose.Types.ObjectId.isValid(cleanId)
        ? { $or: [{ _id: cleanId }, { bookingId: cleanId }] }
        : { bookingId: cleanId };
};

// ==========================================
// Shared Core: Lightweight List Fetcher by Category ('OPD' | 'IPD' | 'EMERGENCY')
// ==========================================
const fetchCategoryAppointmentsList = async (req, res, categoryMode) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const { status, date, search, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (pageNum - 1) * limitNum;

        const andConditions = [
            {
                $or: [
                    { doctorId: doctorId },
                    { pendingDoctorId: doctorId },
                    { 'bedsideCareTeam.doctorId': doctorId }
                ]
            }
        ];

        if (clinicId) {
            andConditions.push({ clinicId });
        }

        // Category Filter
        if (categoryMode === 'OPD') {
            andConditions.push({ bookingType: 'Appointment' });
        } else if (categoryMode === 'IPD') {
            andConditions.push({ bookingType: 'Admission' });
        } else if (categoryMode === 'EMERGENCY') {
            andConditions.push({
                $or: [
                    { bookingType: 'Emergency' },
                    { triageLevel: 'Emergency' }
                ]
            });
        }

        // Optional Status Filter
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

        // Optional Date Filter
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

        // Optional Search Filter
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

        const query = { $and: andConditions };

        const [totalDocs, docs] = await Promise.all([
            Appointment.countDocuments(query),
            Appointment.find(query)
                .select('_id bookingId bookingType consultationType status doctorAcceptanceStatus triageLevel bookingReason isDoctorSelectedAlready appointmentDate appointmentTime startDate endDate stayDuration wardName bedNumber ambulanceId totalAmount paymentStatus userId doctorId pendingDoctorId patients address createdAt')
                .populate('userId', 'name phone profilePic gender dob age familyMember')
                .populate('ambulanceId', 'vehicleNumber vehicleType')
                .sort({ appointmentDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        // Lightweight summary payload per item
        const data = docs.map((appt) => {
            const patientProfile = resolvePatientProfile(appt);
            const dateVal = appt.appointmentDate || appt.startDate;
            const isPendingHandover = Boolean(
                appt.pendingDoctorId && String(appt.pendingDoctorId) === String(doctorId)
            );
            const acceptanceState = appt.doctorAcceptanceStatus || 'Pending';

            const baseItem = {
                _id: appt._id,
                bookingId: appt.bookingId,
                categoryTag: categoryMode,
                bookingType: appt.bookingType,
                status: appt.status,
                doctorAcceptanceStatus: acceptanceState,
                isDoctorSelectedAlready: Boolean(appt.isDoctorSelectedAlready),
                canRespondToAssignment: ((String(appt.doctorId) === String(doctorId) && acceptanceState === 'Pending') || isPendingHandover) &&
                    !['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic', 'No-Show'].includes(appt.status),
                patient: {
                    name: patientProfile.patientName,
                    age: patientProfile.age,
                    gender: patientProfile.gender,
                    phone: patientProfile.phone,
                    profilePic: patientProfile.profilePic
                },
                reasonForVisit: patientProfile.reasonForVisit,
                paymentStatus: appt.paymentStatus || 'Pending',
                totalAmount: appt.totalAmount || 0,
                createdAt: appt.createdAt
            };

            if (categoryMode === 'OPD') {
                return {
                    ...baseItem,
                    consultationType: appt.consultationType || 'Clinic Visit',
                    appointmentDate: dateVal ? moment(dateVal).format('YYYY-MM-DD') : null,
                    appointmentTime: appt.appointmentTime || "10:30 AM"
                };
            }

            if (categoryMode === 'IPD') {
                return {
                    ...baseItem,
                    wardName: appt.wardName || null,
                    bedNumber: appt.bedNumber || null,
                    stayDuration: appt.stayDuration || 1,
                    startDate: appt.startDate ? moment(appt.startDate).format('YYYY-MM-DD') : null,
                    endDate: appt.endDate ? moment(appt.endDate).format('YYYY-MM-DD') : null
                };
            }

            // EMERGENCY
            return {
                ...baseItem,
                triageLevel: appt.triageLevel || 'Emergency',
                appointmentDate: dateVal ? moment(dateVal).format('YYYY-MM-DD') : null,
                appointmentTime: appt.appointmentTime || null,
                wardName: appt.wardName || null,
                bedNumber: appt.bedNumber || null,
                hasAmbulance: Boolean(appt.ambulanceId),
                ambulanceVehicleNumber: appt.ambulanceId?.vehicleNumber || null
            };
        });

        return res.status(200).json({
            success: true,
            category: categoryMode,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limitNum) || 1,
            currentPage: pageNum,
            limit: limitNum,
            count: data.length,
            data
        });
    } catch (error) {
        console.error(`Get Clinic Doctor ${categoryMode} List Error:`, error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// Shared Core: Full 360° Appointment Detail By ID & Category
// ==========================================
const fetchCategoryAppointmentById = async (req, res, categoryMode) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId || null;
        const idCondition = buildIdCondition(req.params.id);

        if (!idCondition) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID or bookingId is required."
            });
        }

        const andConditions = [
            idCondition,
            {
                $or: [
                    { doctorId: doctorId },
                    { pendingDoctorId: doctorId },
                    { 'bedsideCareTeam.doctorId': doctorId }
                ]
            }
        ];

        if (clinicId) {
            andConditions.push({ clinicId });
        }

        if (categoryMode === 'OPD') {
            andConditions.push({ bookingType: 'Appointment' });
        } else if (categoryMode === 'IPD') {
            andConditions.push({ bookingType: 'Admission' });
        } else if (categoryMode === 'EMERGENCY') {
            andConditions.push({
                $or: [
                    { bookingType: 'Emergency' },
                    { triageLevel: 'Emergency' }
                ]
            });
        }

        const appointment = await Appointment.findOne({ $and: andConditions })
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
                'name email phone speciality qualification qualifications experienceYears gender profileImage signatureImage cabinNumber department dutyStatus fees consultationStatus'
            )
            .populate(
                'pendingDoctorId',
                'name speciality qualification profileImage phone dutyStatus'
            )
            .populate('wardId', 'name type totalBeds availableBeds pricePerDay')
            .populate('bedId', 'bedNumber status pricePerDay')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone pricing supportStaff')
            .populate('opdAppointmentId', 'bookingId appointmentDate appointmentTime status')
            .populate('prescriptionId')
            .populate('couponDetails.couponId', 'couponName discountPercentage maxDiscount')
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
                message: `${categoryMode} appointment not found or you are not authorized to view it.`
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
            category: categoryMode,
            data: {
                ...appointment,
                categoryTag: categoryMode,
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
        console.error(`Get Clinic Doctor ${categoryMode} By ID Error:`, error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 1. OPD LIST (Light Info)
// @route   GET /api/clinic/doctor-panel/opd/appointments
// ==========================================
const getClinicDoctorOpdList = (req, res) => fetchCategoryAppointmentsList(req, res, 'OPD');

// ==========================================
// 2. OPD DETAIL BY ID (Full 360° Info)
// @route   GET /api/clinic/doctor-panel/opd/appointments/:id
// ==========================================
const getClinicDoctorOpdById = (req, res) => fetchCategoryAppointmentById(req, res, 'OPD');

// ==========================================
// 3. IPD LIST (Light Info)
// @route   GET /api/clinic/doctor-panel/ipd/appointments
// ==========================================
const getClinicDoctorIpdList = (req, res) => fetchCategoryAppointmentsList(req, res, 'IPD');

// ==========================================
// 4. IPD DETAIL BY ID (Full 360° Info)
// @route   GET /api/clinic/doctor-panel/ipd/appointments/:id
// ==========================================
const getClinicDoctorIpdById = (req, res) => fetchCategoryAppointmentById(req, res, 'IPD');

// ==========================================
// 5. EMERGENCY LIST (Light Info)
// @route   GET /api/clinic/doctor-panel/emergency/appointments
// ==========================================
const getClinicDoctorEmergencyList = (req, res) => fetchCategoryAppointmentsList(req, res, 'EMERGENCY');

// ==========================================
// 6. EMERGENCY DETAIL BY ID (Full 360° Info)
// @route   GET /api/clinic/doctor-panel/emergency/appointments/:id
// ==========================================
const getClinicDoctorEmergencyById = (req, res) => fetchCategoryAppointmentById(req, res, 'EMERGENCY');

module.exports = {
    getClinicDoctorOpdList,
    getClinicDoctorOpdById,
    getClinicDoctorIpdList,
    getClinicDoctorIpdById,
    getClinicDoctorEmergencyList,
    getClinicDoctorEmergencyById
};