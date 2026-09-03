// controllers/clinic/clinicTimingController.js
const Clinic = require('../../models/Clinic');
const Availability = require('../../models/Availability');
const moment = require('moment');

// --- HELPER: Shift Duration & Metrics Calculator ---
const calculateMetrics = (startDay, endDay, morningStart, morningEnd, eveningStart, eveningEnd, holiday) => {
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // 1. Calculate Working Days Count
    let workingDaysCount = 6; // Default
    if (startDay && endDay) {
        const startIndex = daysOrder.indexOf(startDay);
        const endIndex = daysOrder.indexOf(endDay);
        if (startIndex !== -1 && endIndex !== -1) {
            if (endIndex >= startIndex) {
                workingDaysCount = (endIndex - startIndex + 1);
            } else {
                workingDaysCount = (7 - startIndex + endIndex + 1);
            }
        }
    }

    // Adjust if holiday falls in the working range
    if (holiday && holiday !== 'None') {
        workingDaysCount = Math.max(1, workingDaysCount);
    }

    // 2. Parse Shift Timings (supports "09:00 AM" or "09:00")
    const parseTime = (tStr) => {
        if (!tStr) return null;
        return moment(tStr, ['hh:mm A', 'HH:mm', 'h:mm A']);
    };

    let morningHours = 0;
    let eveningHours = 0;

    const mStart = parseTime(morningStart);
    const mEnd = parseTime(morningEnd);
    if (mStart && mEnd && mEnd.isAfter(mStart)) {
        morningHours = moment.duration(mEnd.diff(mStart)).asHours();
    }

    const eStart = parseTime(eveningStart);
    const eEnd = parseTime(eveningEnd);
    if (eStart && eEnd && eEnd.isAfter(eStart)) {
        eveningHours = moment.duration(eEnd.diff(eStart)).asHours();
    }

    const dailyHours = parseFloat((morningHours + eveningHours).toFixed(1));
    const weeklyHours = parseFloat((dailyHours * workingDaysCount).toFixed(1));

    return {
        workingDaysCount,
        dailyHours: `${dailyHours}h`,
        weeklyHours: `${weeklyHours}h`,
        morningDurationHours: morningHours,
        eveningDurationHours: eveningHours
    };
};

// --- HELPER: Generate Discrete OPD Booking Slots ---
const generateShiftSlots = (startTimeStr, endTimeStr, slotDuration = 30) => {
    if (!startTimeStr || !endTimeStr) return [];
    const slots = [];
    const start = moment(startTimeStr, ['hh:mm A', 'HH:mm', 'h:mm A']);
    const end = moment(endTimeStr, ['hh:mm A', 'HH:mm', 'h:mm A']);

    while (start.clone().add(slotDuration, 'minutes').isSameOrBefore(end)) {
        const next = start.clone().add(slotDuration, 'minutes');
        slots.push({
            startTime: start.format('hh:mm A'),
            endTime: next.format('hh:mm A'),
            display: `${start.format('hh:mm A')} - ${next.format('hh:mm A')}`,
            value: start.format('HH:mm')
        });
        start.add(slotDuration, 'minutes');
    }
    return slots;
};

// ==========================================
// 1. GET CLINIC TIMINGS & SUMMARY METRICS
// Endpoint: GET /api/clinic/timings
// ==========================================
const getClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const clinic = await Clinic.findById(clinicId).select(
            'startDay endDay MorningStartTime MorningEndTime eveningStartTime eveningEndTime holiday clinicName'
        );

        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        // Default fallbacks matching UI screenshot
        const startDay = clinic.startDay || 'Monday';
        const endDay = clinic.endDay || 'Saturday';
        const morningStart = clinic.MorningStartTime || '09:00 AM';
        const morningEnd = clinic.MorningEndTime || '01:00 PM';
        const eveningStart = clinic.eveningStartTime || '02:00 PM';
        const eveningEnd = clinic.eveningEndTime || '06:00 PM';
        const holiday = clinic.holiday || 'Sunday';

        const metrics = calculateMetrics(
            startDay, endDay, morningStart, morningEnd, eveningStart, eveningEnd, holiday
        );

        res.json({
            success: true,
            data: {
                workingDaysRange: {
                    startDay,
                    endDay
                },
                morningShift: {
                    shiftStartTime: morningStart,
                    shiftEndTime: morningEnd,
                    displayTime: `${morningStart} - ${morningEnd}`
                },
                eveningShift: {
                    shiftStartTime: eveningStart,
                    shiftEndTime: eveningEnd,
                    displayTime: `${eveningStart} - ${eveningEnd}`
                },
                weeklyHoliday: holiday,
                summary: {
                    workingDays: `${startDay} - ${endDay}`,
                    weeklyHoliday: holiday,
                    morningShiftFormatted: `${moment(morningStart, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(morningEnd, ['hh:mm A', 'HH:mm']).format('HH:mm')}`,
                    eveningShiftFormatted: `${moment(eveningStart, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(eveningEnd, ['hh:mm A', 'HH:mm']).format('HH:mm')}`
                },
                bandwidthMetrics: {
                    days: metrics.workingDaysCount,
                    daily: metrics.dailyHours,
                    weekly: metrics.weeklyHours
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. SAVE & UPDATE CLINIC TIMINGS
// Endpoint: POST /api/clinic/timings OR PUT /api/clinic/timings
// ==========================================
const updateClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            startDay,
            endDay,
            morningStartTime,
            morningEndTime,
            eveningStartTime,
            eveningEndTime,
            holiday,
            slotDuration = 30
        } = req.body;

        // 1. Update Clinic Model directly
        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            {
                $set: {
                    startDay: startDay || 'Monday',
                    endDay: endDay || 'Saturday',
                    MorningStartTime: morningStartTime || '09:00 AM',
                    MorningEndTime: morningEndTime || '01:00 PM',
                    eveningStartTime: eveningStartTime || '02:00 PM',
                    eveningEndTime: eveningEndTime || '06:00 PM',
                    holiday: holiday || 'Sunday'
                }
            },
            { new: true }
        );

        // 2. Sync / Upsert Availability Model for Slot Engine
        await Availability.findOneAndUpdate(
            { vendorId: clinicId, vendorType: 'Clinic' },
            {
                $set: {
                    vendorId: clinicId,
                    vendorType: 'Clinic',
                    morningSlots: !!morningStartTime && !!morningEndTime,
                    afternoonSlots: true,
                    eveningSlots: !!eveningStartTime && !!eveningEndTime,
                    startTime: moment(morningStartTime || '09:00 AM', ['hh:mm A', 'HH:mm']).format('HH:mm'),
                    endTime: moment(eveningEndTime || '06:00 PM', ['hh:mm A', 'HH:mm']).format('HH:mm'),
                    slotDuration: Number(slotDuration),
                    offDays: holiday ? [holiday] : ['Sunday']
                }
            },
            { upsert: true, new: true }
        );

        const metrics = calculateMetrics(
            updatedClinic.startDay,
            updatedClinic.endDay,
            updatedClinic.MorningStartTime,
            updatedClinic.MorningEndTime,
            updatedClinic.eveningStartTime,
            updatedClinic.eveningEndTime,
            updatedClinic.holiday
        );

        res.json({
            success: true,
            message: "Clinic timings & shift schedule updated successfully.",
            data: {
                workingDaysRange: {
                    startDay: updatedClinic.startDay,
                    endDay: updatedClinic.endDay
                },
                morningShift: {
                    shiftStartTime: updatedClinic.MorningStartTime,
                    shiftEndTime: updatedClinic.MorningEndTime
                },
                eveningShift: {
                    shiftStartTime: updatedClinic.eveningStartTime,
                    shiftEndTime: updatedClinic.eveningEndTime
                },
                weeklyHoliday: updatedClinic.holiday,
                summary: {
                    workingDays: `${updatedClinic.startDay} - ${updatedClinic.endDay}`,
                    weeklyHoliday: updatedClinic.holiday,
                    morningShiftFormatted: `${moment(updatedClinic.MorningStartTime, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(updatedClinic.MorningEndTime, ['hh:mm A', 'HH:mm']).format('HH:mm')}`,
                    eveningShiftFormatted: `${moment(updatedClinic.eveningStartTime, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(updatedClinic.eveningEndTime, ['hh:mm A', 'HH:mm']).format('HH:mm')}`
                },
                bandwidthMetrics: {
                    days: metrics.workingDaysCount,
                    daily: metrics.dailyHours,
                    weekly: metrics.weeklyHours
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. RESET / DELETE TIMINGS (Back to Default 9 to 6)
// Endpoint: DELETE /api/clinic/timings
// ==========================================
const resetClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            {
                $set: {
                    startDay: 'Monday',
                    endDay: 'Saturday',
                    MorningStartTime: '09:00 AM',
                    MorningEndTime: '01:00 PM',
                    eveningStartTime: '02:00 PM',
                    eveningEndTime: '06:00 PM',
                    holiday: 'Sunday'
                }
            },
            { new: true }
        );

        await Availability.findOneAndDelete({ vendorId: clinicId, vendorType: 'Clinic' });

        res.json({
            success: true,
            message: "Clinic timings reset to default working schedule (Mon-Sat, 9AM-6PM, Sun Off)."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET GENERATED TIME SLOTS FOR PATIENT OPD BOOKING
// Endpoint: GET /api/clinic/timings/slots?date=YYYY-MM-DD
// ==========================================
const getAvailableBookingSlots = async (req, res) => {
    try {
        const clinicId = req.params.clinicId || req.user.id;
        const { date, slotDuration = 30 } = req.query;

        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found." });
        }

        const targetDate = date ? moment(date) : moment();
        const dayName = targetDate.format('dddd'); // e.g. "Sunday"

        // Check if target date is clinic's weekly holiday
        if (clinic.holiday && clinic.holiday.toLowerCase() === dayName.toLowerCase()) {
            return res.json({
                success: true,
                isClosed: true,
                message: `Clinic is closed on ${dayName} (Weekly Holiday).`,
                morningSlots: [],
                eveningSlots: []
            });
        }

        const morningSlots = generateShiftSlots(
            clinic.MorningStartTime || '09:00 AM',
            clinic.MorningEndTime || '01:00 PM',
            Number(slotDuration)
        );

        const eveningSlots = generateShiftSlots(
            clinic.eveningStartTime || '02:00 PM',
            clinic.eveningEndTime || '06:00 PM',
            Number(slotDuration)
        );

        res.json({
            success: true,
            isClosed: false,
            date: targetDate.format('YYYY-MM-DD'),
            day: dayName,
            totalSlotsCount: morningSlots.length + eveningSlots.length,
            morningSlots,
            eveningSlots
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getClinicTimings,
    updateClinicTimings,
    resetClinicTimings,
    getAvailableBookingSlots
};