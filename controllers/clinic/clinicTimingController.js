// controllers/clinic/clinicTimingController.js
const Clinic = require('../../models/Clinic');
const Availability = require('../../models/Availability');
const { generateTimeSlots } = require('../../utils/timeSlotHelper');
const moment = require('moment');
const Pharmacy = require('../../models/Pharmacy');
const Lab = require('../../models/Lab');

// Helper: Calculate Metrics (Considers 24x7 & Shifts)
const calculateMetrics = (startDay, endDay, morningStart, morningEnd, eveningStart, eveningEnd, holiday, is24x7) => {
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // If 24/7, all 7 days with 24 hours
    if (is24x7) {
        return {
            workingDaysCount: 7,
            dailyHours: '24.0h',
            weeklyHours: '168.0h',
            morningDurationHours: 12,
            eveningDurationHours: 12
        };
    }

    let workingDaysCount = 6;
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

    if (holiday && holiday !== 'None') {
        workingDaysCount = Math.max(1, workingDaysCount);
    }

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

// Helper: Generate Discrete OPD Booking Slots
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
// 1. GET CLINIC TIMINGS & FACILITIES CONFIG
// Endpoint: GET /api/clinic/timings
// ==========================================
const getClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const clinic = await Clinic.findById(clinicId);

        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        const is24x7 = Boolean(clinic.is24x7);
        const startDay = clinic.startDay || 'Monday';
        const endDay = clinic.endDay || 'Saturday';
        const morningStart = clinic.MorningStartTime || '09:00 AM';
        const morningEnd = clinic.MorningEndTime || '01:00 PM';
        const eveningStart = clinic.eveningStartTime || '02:00 PM';
        const eveningEnd = clinic.eveningEndTime || '06:00 PM';
        const holiday = clinic.holiday || 'Sunday';

        const metrics = calculateMetrics(
            startDay, endDay, morningStart, morningEnd, eveningStart, eveningEnd, holiday, is24x7
        );

        res.json({
            success: true,
            data: {
                // Facilities Switches
                facilities: {
                    is24x7: is24x7,
                    isOPD: clinic.isOPD !== undefined ? clinic.isOPD : true,
                    isIPD: clinic.isIPD || false,
                    isEmergency: clinic.isEmergency || false
                },
                // Service-Specific Custom Timings
                serviceTimings: {
                    emergency: clinic.emergencyTimings || {
                        is24x7: is24x7,
                        startTime: is24x7 ? "12:00 AM" : "08:00 PM",
                        endTime: is24x7 ? "11:59 PM" : "08:00 AM"
                    },
                    ipd: clinic.ipdTimings || {
                        is24x7: is24x7,
                        startTime: "09:00 AM",
                        endTime: "08:00 PM"
                    },
                    opd: clinic.opdTimings || {
                        is24x7: is24x7,
                        startTime: morningStart,
                        endTime: eveningEnd
                    }
                },
                // General Shifts
                workingDaysRange: {
                    startDay,
                    endDay
                },
                morningShift: {
                    shiftStartTime: morningStart,
                    shiftEndTime: morningEnd,
                    displayTime: is24x7 ? "24 Hours Active" : `${morningStart} - ${morningEnd}`
                },
                eveningShift: {
                    shiftStartTime: eveningStart,
                    shiftEndTime: eveningEnd,
                    displayTime: is24x7 ? "24 Hours Active" : `${eveningStart} - ${eveningEnd}`
                },
                weeklyHoliday: is24x7 ? "Open All Days" : holiday,
                summary: {
                    workingDays: is24x7 ? "Open 7 Days (24x7)" : `${startDay} - ${endDay}`,
                    weeklyHoliday: is24x7 ? "No Holiday" : holiday,
                    morningShiftFormatted: is24x7 ? "00:00 - 23:59" : `${moment(morningStart, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(morningEnd, ['hh:mm A', 'HH:mm']).format('HH:mm')}`,
                    eveningShiftFormatted: is24x7 ? "00:00 - 23:59" : `${moment(eveningStart, ['hh:mm A', 'HH:mm']).format('HH:mm')} - ${moment(eveningEnd, ['hh:mm A', 'HH:mm']).format('HH:mm')}`
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
// 2. SAVE & UPDATE CLINIC TIMINGS & FACILITIES
// Endpoint: POST /api/clinic/timings/create OR PUT /api/clinic/timings/update
// ==========================================
const updateClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            // Facilities Toggles
            is24x7 = false,
            isOPD = true,
            isIPD = false,
            isEmergency = false,
            isAmbulanceAvailable = false, // 👈 Added Ambulance Facility Toggle

            // Specific Service Timing Objects
            emergencyTimings,
            ipdTimings,
            opdTimings,

            // Standard Shift Timings
            startDay,
            endDay,
            morningStartTime,
            morningEndTime,
            eveningStartTime,
            eveningEndTime,
            holiday,
            slotDuration = 30
        } = req.body;

        const is24x7Bool = Boolean(is24x7);

        // Prepare update object
        const updatePayload = {
            is24x7: is24x7Bool,
            isOPD: Boolean(isOPD),
            isIPD: Boolean(isIPD),
            isEmergency: Boolean(isEmergency),
            isAmbulanceAvailable: Boolean(isAmbulanceAvailable), // 👈 Saved to Clinic Profile

            startDay: startDay || 'Monday',
            endDay: endDay || 'Saturday',
            holiday: is24x7Bool ? 'None' : (holiday || 'Sunday'),

            MorningStartTime: is24x7Bool ? '12:00 AM' : (morningStartTime || '09:00 AM'),
            MorningEndTime: is24x7Bool ? '12:00 PM' : (morningEndTime || '01:00 PM'),
            eveningStartTime: is24x7Bool ? '12:00 PM' : (eveningStartTime || '02:00 PM'),
            eveningEndTime: is24x7Bool ? '11:59 PM' : (eveningEndTime || '06:00 PM'),

            emergencyTimings: {
                is24x7: is24x7Bool || Boolean(emergencyTimings?.is24x7),
                startTime: is24x7Bool ? "12:00 AM" : (emergencyTimings?.startTime || "06:00 PM"),
                endTime: is24x7Bool ? "11:59 PM" : (emergencyTimings?.endTime || "09:00 AM")
            },
            ipdTimings: {
                is24x7: is24x7Bool || Boolean(ipdTimings?.is24x7),
                startTime: is24x7Bool ? "12:00 AM" : (ipdTimings?.startTime || "10:00 AM"),
                endTime: is24x7Bool ? "11:59 PM" : (ipdTimings?.endTime || "08:00 PM")
            },
            opdTimings: {
                is24x7: is24x7Bool || Boolean(opdTimings?.is24x7),
                startTime: is24x7Bool ? "12:00 AM" : (opdTimings?.startTime || morningStartTime || "09:00 AM"),
                endTime: is24x7Bool ? "11:59 PM" : (opdTimings?.endTime || eveningEndTime || "06:00 PM")
            }
        };

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { $set: updatePayload },
            { new: true }
        );

        // Sync to Availability engine
        await Availability.findOneAndUpdate(
            { vendorId: clinicId, vendorType: 'Clinic' },
            {
                $set: {
                    vendorId: clinicId,
                    vendorType: 'Clinic',
                    morningSlots: true,
                    afternoonSlots: true,
                    eveningSlots: true,
                    startTime: is24x7Bool ? "00:00" : moment(updatePayload.MorningStartTime, ['hh:mm A', 'HH:mm']).format('HH:mm'),
                    endTime: is24x7Bool ? "23:59" : moment(updatePayload.eveningEndTime, ['hh:mm A', 'HH:mm']).format('HH:mm'),
                    slotDuration: Number(slotDuration),
                    offDays: is24x7Bool ? [] : [updatePayload.holiday]
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
            updatedClinic.holiday,
            updatedClinic.is24x7
        );

        res.json({
            success: true,
            message: "Clinic facilities, ambulance service & shift timings updated successfully.",
            data: {
                facilities: {
                    is24x7: updatedClinic.is24x7,
                    isOPD: updatedClinic.isOPD,
                    isIPD: updatedClinic.isIPD,
                    isEmergency: updatedClinic.isEmergency,
                    isAmbulanceAvailable: Boolean(updatedClinic.isAmbulanceAvailable) // 👈 Returned in facilities
                },
                serviceTimings: {
                    emergency: updatedClinic.emergencyTimings,
                    ipd: updatedClinic.ipdTimings,
                    opd: updatedClinic.opdTimings
                },
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
// 3. RESET / DELETE TIMINGS
// Endpoint: DELETE /api/clinic/timings/delete
// ==========================================
const resetClinicTimings = async (req, res) => {
    try {
        const clinicId = req.user.id;

        await Clinic.findByIdAndUpdate(
            clinicId,
            {
                $set: {
                    is24x7: false,
                    isOPD: true,
                    isIPD: false,
                    isEmergency: false,
                    startDay: 'Monday',
                    endDay: 'Saturday',
                    MorningStartTime: '09:00 AM',
                    MorningEndTime: '01:00 PM',
                    eveningStartTime: '02:00 PM',
                    eveningEndTime: '06:00 PM',
                    holiday: 'Sunday',
                    emergencyTimings: { is24x7: false, startTime: "", endTime: "" },
                    ipdTimings: { is24x7: false, startTime: "", endTime: "" },
                    opdTimings: { is24x7: false, startTime: "", endTime: "" }
                }
            }
        );

        await Availability.findOneAndDelete({ vendorId: clinicId, vendorType: 'Clinic' });

        res.json({
            success: true,
            message: "Clinic timings and facility schedules reset to default."
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET BOOKING TIME SLOTS (Handles 24x7 vs Holiday vs Shifts)
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
        const dayName = targetDate.format('dddd');

        // If not 24/7, check holiday
        if (!clinic.is24x7 && clinic.holiday && clinic.holiday.toLowerCase() === dayName.toLowerCase()) {
            return res.json({
                success: true,
                isClosed: true,
                message: `Clinic is closed on ${dayName} (Weekly Holiday).`,
                morningSlots: [],
                eveningSlots: []
            });
        }

        // 24/7 Full Day Generation vs Shift Generation
        const morningSlots = generateShiftSlots(
            clinic.is24x7 ? '00:00' : (clinic.MorningStartTime || '09:00 AM'),
            clinic.is24x7 ? '12:00' : (clinic.MorningEndTime || '01:00 PM'),
            Number(slotDuration)
        );

        const eveningSlots = generateShiftSlots(
            clinic.is24x7 ? '12:00' : (clinic.eveningStartTime || '02:00 PM'),
            clinic.is24x7 ? '23:59' : (clinic.eveningEndTime || '06:00 PM'),
            Number(slotDuration)
        );

        res.json({
            success: true,
            isClosed: false,
            is24x7: Boolean(clinic.is24x7),
            facilities: {
                isOPD: clinic.isOPD,
                isIPD: clinic.isIPD,
                isEmergency: clinic.isEmergency
            },
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

// ==========================================
// 1. GET CLINIC PHARMACY TIMINGS & GENERATED SLOTS
// Endpoint: GET /api/clinic/timings/pharmacy
// ==========================================
const getClinicPharmacyTiming = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true })
            .select('name is24x7 openingTime closeTime holiday');

        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "No pharmacy registered under this clinic." });
        }

        // Fetch Availability Slots Configuration
        const config = await Availability.findOne({ vendorId: pharmacy._id });

        let generatedSlots = [];
        if (config && !pharmacy.is24x7) {
            generatedSlots = generateTimeSlots(config);
        }

        res.json({
            success: true,
            data: {
                pharmacyId: pharmacy._id,
                name: pharmacy.name,
                is24x7: Boolean(pharmacy.is24x7),
                openingTime: pharmacy.openingTime || "09:00 AM",
                closeTime: pharmacy.closeTime || "09:00 PM",
                holiday: pharmacy.holiday || "Sunday",
                displayTiming: pharmacy.is24x7 ? "Open 24x7" : `${pharmacy.openingTime} - ${pharmacy.closeTime}`,
                config: config || null,
                totalSlotsCount: generatedSlots.length,
                generatedSlots
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. SET / UPDATE CLINIC PHARMACY TIMINGS & SLOTS
// Endpoint: PUT /api/clinic/timings/pharmacy
// ==========================================
const updateClinicPharmacyTiming = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            is24x7,
            openingTime,
            closeTime,
            holiday,
            slotDuration = 30,
            maxClientsPerSlot = 0,
            morningSlots = true,
            afternoonSlots = true,
            eveningSlots = true,
            offDays,
            blockedDates,
            premiumSlots
        } = req.body;

        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "No pharmacy registered under this clinic." });
        }

        const is24x7Bool = is24x7 === true || is24x7 === 'true';

        // 1. Update Pharmacy Document
        pharmacy.is24x7 = is24x7Bool;
        pharmacy.openingTime = is24x7Bool ? "12:00 AM" : (openingTime || pharmacy.openingTime || "09:00 AM");
        pharmacy.closeTime = is24x7Bool ? "11:59 PM" : (closeTime || pharmacy.closeTime || "09:00 PM");
        pharmacy.holiday = is24x7Bool ? "None" : (holiday || pharmacy.holiday || "Sunday");
        await pharmacy.save();

        // 2. Sync / Upsert Availability Slots Engine
        const availabilityPayload = {
            vendorId: pharmacy._id,
            vendorType: 'clinic-pharmacy',
            clinicId: clinicId,
            startTime: is24x7Bool ? "00:00" : (req.body.startTime || "09:00"),
            endTime: is24x7Bool ? "23:59" : (req.body.endTime || "21:00"),
            slotDuration: Number(slotDuration),
            maxClientsPerSlot: Number(maxClientsPerSlot),
            morningSlots: Boolean(morningSlots),
            afternoonSlots: Boolean(afternoonSlots),
            eveningSlots: Boolean(eveningSlots),
            offDays: is24x7Bool ? [] : (offDays || [pharmacy.holiday]),
            blockedDates: blockedDates || [],
            premiumSlots: premiumSlots || []
        };

        const updatedConfig = await Availability.findOneAndUpdate(
            { vendorId: pharmacy._id },
            { $set: availabilityPayload },
            { upsert: true, new: true }
        );

        let generatedSlots = [];
        if (!is24x7Bool && updatedConfig) {
            generatedSlots = generateTimeSlots(updatedConfig);
        }

        res.json({
            success: true,
            message: "Clinic Pharmacy timings and time slots updated successfully.",
            data: {
                pharmacyId: pharmacy._id,
                name: pharmacy.name,
                is24x7: pharmacy.is24x7,
                openingTime: pharmacy.openingTime,
                closeTime: pharmacy.closeTime,
                holiday: pharmacy.holiday,
                config: updatedConfig,
                totalSlotsCount: generatedSlots.length,
                generatedSlots
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 1. GET CLINIC LAB TIMINGS & GENERATED SLOTS
// Endpoint: GET /api/clinic/timings/lab
// ==========================================
const getClinicLabTiming = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const lab = await Lab.findOne({ clinicId, isClinic: true })
            .select('name is24x7 openingTime closeTime holiday');

        if (!lab) {
            return res.status(404).json({ success: false, message: "No diagnostic lab registered under this clinic." });
        }

        // Fetch Availability Slots Configuration
        const config = await Availability.findOne({ vendorId: lab._id });

        let generatedSlots = [];
        if (config && !lab.is24x7) {
            generatedSlots = generateTimeSlots(config);
        }

        res.json({
            success: true,
            data: {
                labId: lab._id,
                name: lab.name,
                is24x7: Boolean(lab.is24x7),
                openingTime: lab.openingTime || "08:00 AM",
                closeTime: lab.closeTime || "08:00 PM",
                holiday: lab.holiday || "Sunday",
                displayTiming: lab.is24x7 ? "Open 24x7" : `${lab.openingTime} - ${lab.closeTime}`,
                config: config || null,
                totalSlotsCount: generatedSlots.length,
                generatedSlots
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. SET / UPDATE CLINIC LAB TIMINGS & SLOTS
// Endpoint: PUT /api/clinic/timings/lab
// ==========================================
const updateClinicLabTiming = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const {
            is24x7,
            openingTime,
            closeTime,
            holiday,
            slotDuration = 30,
            maxClientsPerSlot = 2,
            morningSlots = true,
            afternoonSlots = true,
            eveningSlots = false,
            offDays,
            blockedDates,
            premiumSlots
        } = req.body;

        const lab = await Lab.findOne({ clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "No diagnostic lab registered under this clinic." });
        }

        const is24x7Bool = is24x7 === true || is24x7 === 'true';

        // 1. Update Lab Document
        lab.is24x7 = is24x7Bool;
        lab.openingTime = is24x7Bool ? "12:00 AM" : (openingTime || lab.openingTime || "08:00 AM");
        lab.closeTime = is24x7Bool ? "11:59 PM" : (closeTime || lab.closeTime || "08:00 PM");
        lab.holiday = is24x7Bool ? "None" : (holiday || lab.holiday || "Sunday");
        await lab.save();

        // 2. Sync / Upsert Availability Slots Engine
        const availabilityPayload = {
            vendorId: lab._id,
            vendorType: 'clinic-lab',
            clinicId: clinicId,
            startTime: is24x7Bool ? "00:00" : (req.body.startTime || "08:00"),
            endTime: is24x7Bool ? "23:59" : (req.body.endTime || "20:00"),
            slotDuration: Number(slotDuration),
            maxClientsPerSlot: Number(maxClientsPerSlot),
            morningSlots: Boolean(morningSlots),
            afternoonSlots: Boolean(afternoonSlots),
            eveningSlots: Boolean(eveningSlots),
            offDays: is24x7Bool ? [] : (offDays || [lab.holiday]),
            blockedDates: blockedDates || [],
            premiumSlots: premiumSlots || []
        };

        const updatedConfig = await Availability.findOneAndUpdate(
            { vendorId: lab._id },
            { $set: availabilityPayload },
            { upsert: true, new: true }
        );

        let generatedSlots = [];
        if (!is24x7Bool && updatedConfig) {
            generatedSlots = generateTimeSlots(updatedConfig);
        }

        res.json({
            success: true,
            message: "Clinic Lab timings and test time slots updated successfully.",
            data: {
                labId: lab._id,
                name: lab.name,
                is24x7: lab.is24x7,
                openingTime: lab.openingTime,
                closeTime: lab.closeTime,
                holiday: lab.holiday,
                config: updatedConfig,
                totalSlotsCount: generatedSlots.length,
                generatedSlots
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 3. BLOCK / HIDE CLINIC LAB TIME SLOT
// Endpoint: POST /api/clinic/timings/lab/block-slot
// ==========================================
const blockClinicLabSlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { time } = req.body;

        if (!time) {
            return res.status(400).json({ success: false, message: "Time slot is required (e.g. '10:30')" });
        }

        const lab = await Lab.findOne({ clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "No diagnostic lab registered under this clinic." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: lab._id },
            { 
                $set: { vendorType: 'clinic-lab', clinicId },
                $addToSet: { unavailableSlots: time } 
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: `Time slot '${time}' hidden successfully for Clinic Lab.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UNBLOCK / SHOW CLINIC LAB TIME SLOT
// Endpoint: POST /api/clinic/timings/lab/unblock-slot
// ==========================================
const unblockClinicLabSlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { time } = req.body;

        if (!time) {
            return res.status(400).json({ success: false, message: "Time slot is required (e.g. '10:30')" });
        }

        const lab = await Lab.findOne({ clinicId, isClinic: true });
        if (!lab) {
            return res.status(404).json({ success: false, message: "No diagnostic lab registered under this clinic." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: lab._id },
            { $pull: { unavailableSlots: time } }
        );

        res.json({
            success: true,
            message: `Time slot '${time}' is now visible and bookable again for Clinic Lab.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. BLOCK / HIDE CLINIC PHARMACY TIME SLOT
// Endpoint: POST /api/clinic/timings/pharmacy/block-slot
// ==========================================
const blockClinicPharmacySlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { time } = req.body;

        if (!time) {
            return res.status(400).json({ success: false, message: "Time slot is required (e.g. '14:00')" });
        }

        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "No pharmacy registered under this clinic." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: pharmacy._id },
            { 
                $set: { vendorType: 'clinic-pharmacy', clinicId },
                $addToSet: { unavailableSlots: time } 
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: `Time slot '${time}' hidden successfully for Clinic Pharmacy.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. UNBLOCK / SHOW CLINIC PHARMACY TIME SLOT
// Endpoint: POST /api/clinic/timings/pharmacy/unblock-slot
// ==========================================
const unblockClinicPharmacySlot = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const { time } = req.body;

        if (!time) {
            return res.status(400).json({ success: false, message: "Time slot is required (e.g. '14:00')" });
        }

        const pharmacy = await Pharmacy.findOne({ clinicId, isClinic: true });
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "No pharmacy registered under this clinic." });
        }

        await Availability.findOneAndUpdate(
            { vendorId: pharmacy._id },
            { $pull: { unavailableSlots: time } }
        );

        res.json({
            success: true,
            message: `Time slot '${time}' is now visible and active again for Clinic Pharmacy.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getClinicTimings,
    updateClinicTimings,
    resetClinicTimings,
    getAvailableBookingSlots,
    getClinicPharmacyTiming,
    updateClinicPharmacyTiming,
    getClinicLabTiming,
    updateClinicLabTiming,
    blockClinicLabSlot,
    unblockClinicLabSlot,
    blockClinicPharmacySlot,
    unblockClinicPharmacySlot
    
};