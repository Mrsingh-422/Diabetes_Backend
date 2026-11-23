// utils/opdTokenHelper.js
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const Availability = require('../models/Availability');
const moment = require('moment');

const formatDurationText = (minutes) => {
    const mins = Math.max(0, Math.round(Number(minutes) || 0));
    if (mins === 0) return "0 mins";
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0 && remMins > 0) return `${hrs} hr${hrs > 1 ? 's' : ''} ${remMins} mins`;
    if (hrs > 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
    return `${remMins} min${remMins > 1 ? 's' : ''}`;
};

const padToken = (num) => {
    if (!num || Number(num) <= 0) return "";
    return String(num).padStart(3, '0');
};

/**
 * Assigns next daily sequential OPD token (001, 002, ...) per Clinic + Doctor + Date.
 * Only applies when bookingType is 'Appointment' (OPD) and doctorId is present.
 */
const assignOpdTokenToAppointment = async (appointment, options = {}) => {
    const { forceRegenerate = false } = options;

    if (!appointment || appointment.bookingType !== 'Appointment' || !appointment.doctorId) {
        return appointment;
    }

    if (appointment.tokenNumber && !forceRegenerate) {
        return appointment;
    }

    const targetDate = moment(appointment.appointmentDate || new Date());
    const dayStart = targetDate.clone().startOf('day').toDate();
    const dayEnd = targetDate.clone().endOf('day').toDate();

    const [doctor, availConfig, lastTokenAppt] = await Promise.all([
        Doctor.findById(appointment.doctorId)
            .select('slotDuration cabinNumber department')
            .lean(),
        Availability.findOne({ vendorId: appointment.doctorId })
            .select('slotDuration startTime')
            .lean(),
        Appointment.findOne({
            _id: { $ne: appointment._id },
            clinicId: appointment.clinicId,
            doctorId: appointment.doctorId,
            bookingType: 'Appointment',
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            tokenNumber: { $ne: null }
        })
            .sort({ tokenNumber: -1 })
            .select('tokenNumber')
            .lean()
    ]);

    const nextTokenNum = (lastTokenAppt?.tokenNumber || 0) + 1;
    const intervalMinutes = Math.max(
        5,
        Number(availConfig?.slotDuration || doctor?.slotDuration || 15)
    );
    const cabinRoom = doctor?.cabinNumber || doctor?.department?.roomNumber || "";

    appointment.tokenNumber = nextTokenNum;
    appointment.formattedToken = padToken(nextTokenNum);
    appointment.tokenIntervalMinutes = intervalMinutes;
    if (cabinRoom) {
        appointment.opdRoomNumber = cabinRoom;
    }

    await appointment.save();
    return appointment;
};

/**
 * Calculates live OPD queue position, patients ahead, and estimated wait time.
 */
const getOpdTokenQueueStatus = async (appointment) => {
    if (!appointment || appointment.bookingType !== 'Appointment' || !appointment.doctorId) {
        return null;
    }

    if (!appointment.tokenNumber) {
        return {
            hasToken: false,
            tokenNumber: null,
            formattedToken: "",
            message: "Token will be generated once doctor is assigned or payment is confirmed."
        };
    }

    const targetDate = moment(appointment.appointmentDate || new Date());
    const dayStart = targetDate.clone().startOf('day').toDate();
    const dayEnd = targetDate.clone().endOf('day').toDate();

    const [doctor, availConfig, dayTokens] = await Promise.all([
        Doctor.findById(appointment.doctorId)
            .select('name speciality slotDuration cabinNumber department')
            .lean(),
        Availability.findOne({ vendorId: appointment.doctorId })
            .select('slotDuration startTime endTime')
            .lean(),
        Appointment.find({
            clinicId: appointment.clinicId,
            doctorId: appointment.doctorId,
            bookingType: 'Appointment',
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            tokenNumber: { $ne: null },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'] }
        })
            .select('_id bookingId tokenNumber formattedToken status isTokenSkipped')
            .sort({ tokenNumber: 1 })
            .lean()
    ]);

    const intervalMinutes = Math.max(
        5,
        Number(appointment.tokenIntervalMinutes || availConfig?.slotDuration || doctor?.slotDuration || 15)
    );
    const totalTokensToday = dayTokens.length;
    const completedTokensCount = dayTokens.filter((t) => t.status === 'Completed' || t.status === 'No-Show').length;

    const currentInProgress = dayTokens.find((t) => t.status === 'In-Progress') || null;
    const nextWaiting = dayTokens.find(
        (t) =>
            !t.isTokenSkipped &&
            ['Confirmed', 'Pending', 'Clinic-Pending', 'Rescheduled'].includes(t.status)
    ) || null;
    const activeTokenDoc = currentInProgress || nextWaiting;

    const myTokenNum = Number(appointment.tokenNumber);
    const myFormattedToken = appointment.formattedToken || padToken(myTokenNum);

    // Waiting or In-Progress tokens strictly ahead (excludes skipped tokens)
    const waitingAheadDocs = dayTokens.filter(
        (t) =>
            Number(t.tokenNumber) < myTokenNum &&
            !t.isTokenSkipped &&
            ['Pending', 'Clinic-Pending', 'Confirmed', 'In-Progress', 'Rescheduled'].includes(t.status)
    );

    const patientsAhead = waitingAheadDocs.length;
    const isMyTurnNow = appointment.status === 'In-Progress';
    const isSkipped = Boolean(appointment.isTokenSkipped);
    const isFinished = ['Completed', 'No-Show', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Clinic'].includes(appointment.status);

    let estimatedWaitMinutes = 0;
    if (!isMyTurnNow && !isFinished && !isSkipped) {
        estimatedWaitMinutes = patientsAhead * intervalMinutes;
    }

    const shiftStartStr = availConfig?.startTime || "09:00";
    const shiftStartMoment = moment(`${targetDate.format('YYYY-MM-DD')} ${shiftStartStr}`, 'YYYY-MM-DD HH:mm');
    const nowMoment = moment();
    const referenceClock = targetDate.isSame(nowMoment, 'day')
        ? moment.max(nowMoment, shiftStartMoment)
        : shiftStartMoment;

    const expectedCallTime = (isMyTurnNow || isFinished || isSkipped)
        ? null
        : referenceClock.clone().add(estimatedWaitMinutes, 'minutes').format('hh:mm A');

    let queueMessage = "";
    if (isMyTurnNow) {
        queueMessage = `Your turn now! Please proceed to ${appointment.opdRoomNumber || doctor?.cabinNumber || 'OPD Cabin'}.`;
    } else if (isSkipped) {
        queueMessage = `Token #${myFormattedToken} was temporarily skipped. Please report to OPD Cabin / Reception when you arrive.`;
    } else if (appointment.status === 'Completed') {
        queueMessage = "Consultation completed.";
    } else if (isFinished) {
        queueMessage = `Appointment is ${appointment.status}.`;
    } else if (patientsAhead === 0) {
        queueMessage = "You are next in queue!";
    } else {
        queueMessage = `${patientsAhead} token(s) ahead of you. Estimated wait: ${formatDurationText(estimatedWaitMinutes)}.`;
    }

    return {
        hasToken: true,
        tokenNumber: myTokenNum,
        formattedToken: myFormattedToken,
        tokenIntervalMinutes: intervalMinutes,
        opdRoomNumber: appointment.opdRoomNumber || doctor?.cabinNumber || doctor?.department?.roomNumber || "",
        isTokenSkipped: isSkipped,
        tokenSkipCount: appointment.tokenSkipCount || 0,
        tokenSkipReason: appointment.tokenSkipReason || "",
        tokenSkippedAt: appointment.tokenSkippedAt || null,
        totalTokensToday,
        completedTokensCount,
        currentServingToken: currentInProgress ? (currentInProgress.formattedToken || padToken(currentInProgress.tokenNumber)) : null,
        currentServingTokenNumber: currentInProgress ? currentInProgress.tokenNumber : null,
        nextInQueueToken: activeTokenDoc ? (activeTokenDoc.formattedToken || padToken(activeTokenDoc.tokenNumber)) : null,
        patientsAhead,
        estimatedWaitMinutes,
        estimatedWaitText: formatDurationText(estimatedWaitMinutes),
        expectedCallTime,
        appointmentStatus: appointment.status,
        queueMessage
    };
};

module.exports = {
    padToken,
    formatDurationText,
    assignOpdTokenToAppointment,
    getOpdTokenQueueStatus
};