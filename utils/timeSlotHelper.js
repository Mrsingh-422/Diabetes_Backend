// utils/timeSlotHelper.js
const moment = require('moment');
const FoodBooking = require('../models/FoodBooking');

// ==========================================
// 1. COMMON TIME SLOTS GENERATOR (Lab / Pharmacy)
// ==========================================
const generateTimeSlots = (config) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    
    // Gap Fix: Infinite loop protection & missing config check
    if (!startTime || !endTime || !slotDuration || slotDuration <= 0) return [];

    let slots = [];
    let [startHour, startMin] = startTime.split(':').map(Number);
    let [endHour, endMin] = endTime.split(':').map(Number);

    let startTotalMinutes = startHour * 60 + startMin;
    let endTotalMinutes = endHour * 60 + endMin;

    for (let minutes = startTotalMinutes; minutes < endTotalMinutes; minutes += slotDuration) {
        let h = Math.floor(minutes / 60);
        let m = minutes % 60;
        let timeString = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

        if (unavailableSlots && unavailableSlots.includes(timeString)) continue;

        let category = "";
        if (h >= 5 && h < 12) category = "Morning";
        else if (h >= 12 && h < 17) category = "Afternoon";
        else if (h >= 17 && h < 23) category = "Evening";

        const isEnabled = (category === "Morning" && morningSlots) ||
                          (category === "Afternoon" && afternoonSlots) ||
                          (category === "Evening" && eveningSlots);

        if (isEnabled) {
            const premiumInfo = premiumSlots ? premiumSlots.find(ps => ps.time === timeString) : null;
            slots.push({ 
                time: timeString, 
                category, 
                extraFee: premiumInfo ? premiumInfo.extraFee : 0 
            });
        }
    }
    return slots;
};

// ==========================================
// 2. FOOD AVAILABILITY CHECKER
// ==========================================
const isFoodAvailable = async (FoodId, payload, FoodBooking, Availability) => {
    const { selectedType, startDate, endDate, startTime, endTime } = payload;

    const reqStart = moment(startDate).startOf('day');
    const reqEnd = (selectedType === 'For Multiple Days') ? moment(endDate).endOf('day') : moment(startDate).endOf('day');

    // 1. Fetch overlapping bookings
    const overlaps = await FoodBooking.find({
        FoodId,
        status: { $in: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] },
        $or: [{ "schedule.startDate": { $lte: reqEnd.toDate() }, "schedule.endDate": { $gte: reqStart.toDate() } }]
    });

    if (overlaps.length > 0) {
        if (selectedType === 'For Multiple Days') {
            return false;
        }

        for (const b of overlaps) {
            if (b.schedule.duration === 'For Multiple Days') {
                return false;
            }
            if (moment(startDate).isSame(b.schedule.startDate, 'day')) {
                // ... hourly/slot overlap logic
            }
        }
    }
    
    // Capacity check
    const config = await Availability.findOne({ vendorId: FoodId });
    const maxCapacity = config ? config.maxClientsPerSlot : 1;
    return overlaps.length < maxCapacity;
};

// ==========================================
// 3. FOOD HOURLY SLOTS GENERATOR
// ==========================================
const generateFoodSlots = (config, baseHourlyFinal) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    if (!startTime || !endTime) return [];

    let slots = [];
    let interval = 60; 
    
    let start = moment(startTime, "HH:mm");
    let end = moment(endTime, "HH:mm");

    while (start.isBefore(end)) {
        let timeString = start.format("HH:mm");
        
        if (!unavailableSlots?.includes(timeString)) {
            const hour = start.hour();
            let category = (hour >= 5 && hour < 12) ? "Morning" : (hour >= 12 && hour < 17) ? "Afternoon" : "Evening";
            
            const isEnabled = (category === "Morning" && morningSlots) || 
                              (category === "Afternoon" && afternoonSlots) || 
                              (category === "Evening" && eveningSlots);

            if (isEnabled) {
                const premium = premiumSlots?.find(p => p.time === timeString);
                const extra = premium ? premium.extraFee : 0;

                slots.push({
                    time: timeString,
                    displayTime: start.format("hh:mm A"),
                    category,
                    hourlyBasePrice: baseHourlyFinal,
                    slotPremiumFee: extra,
                    totalHourlyPrice: Math.round(baseHourlyFinal + extra) 
                });
            }
        }
        start.add(interval, 'minutes');
    }
    return slots;
};

// ==========================================
// 🚑 4. AMBULANCE SLOTS GENERATOR (With Real-Time Double Booking Collision Check)
// ==========================================
const generateAmbulanceSlots = (availabilityConfig, bookedTrips = [], selectedDate) => {
    const startTime = availabilityConfig?.startTime || "00:00";
    const endTime = availabilityConfig?.endTime || "23:59";
    const slotDuration = availabilityConfig?.slotDuration || 120; // 120 mins (2 Hours trip buffer)
    const unavailableSlots = availabilityConfig?.unavailableSlots || [];
    const offDays = availabilityConfig?.offDays || [];

    const dayName = moment(selectedDate).format('dddd');
    if (offDays.includes(dayName)) {
        return { isClosed: true, reason: `Ambulance is off on ${dayName}s.`, slots: [] };
    }

    const slots = [];
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startTotalMinutes = startHour * 60 + startMin;
    const endTotalMinutes = endHour * 60 + endMin;

    const isToday = moment().format('YYYY-MM-DD') === selectedDate;
    const currentMoment = moment();

    for (let minutes = startTotalMinutes; minutes + slotDuration <= endTotalMinutes; minutes += slotDuration) {
        const startH = Math.floor(minutes / 60);
        const startM = minutes % 60;
        const endMinutes = minutes + slotDuration;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;

        const timeString24 = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
        const slotStartMoment = moment(`${selectedDate} ${timeString24}`, 'YYYY-MM-DD HH:mm');
        const slotEndMoment = slotStartMoment.clone().add(slotDuration, 'minutes');

        const displayTime = `${slotStartMoment.format('hh:mm A')} - ${slotEndMoment.format('hh:mm A')}`;

        // 1. Time Categorization
        let category = "Morning";
        if (startH >= 12 && startH < 17) category = "Afternoon";
        else if (startH >= 17 && startH <= 23) category = "Evening / Night";
        else if (startH < 5) category = "Late Night";

        // 2. Past Time Check (For Today)
        const isPast = isToday && slotStartMoment.isBefore(currentMoment);

        // 3. Driver Blocked Check
        const isManuallyBlocked = unavailableSlots.includes(timeString24);

        // 4. 🛡️ COLLISION CHECK: Check against Confirmed / Ongoing Trips
        const hasBookingConflict = bookedTrips.some(trip => {
            const tripTime = trip.scheduledAt || trip.appointmentDate || trip.createdAt;
            const tripStartTime = moment(tripTime);
            const tripEndTime = tripStartTime.clone().add(slotDuration, 'minutes');

            // Overlap: (SlotStart < TripEnd) AND (SlotEnd > TripStart)
            return slotStartMoment.isBefore(tripEndTime) && slotEndMoment.isAfter(tripStartTime);
        });

        const isAvailable = !isPast && !isManuallyBlocked && !hasBookingConflict;

        let statusText = "Available";
        if (isPast) statusText = "Past";
        else if (isManuallyBlocked) statusText = "Unavailable";
        else if (hasBookingConflict) statusText = "Booked"; // 👈 Marked as Booked so others cannot select

        slots.push({
            slotTime: timeString24,
            displayTime,
            startTimeFormatted: slotStartMoment.format('hh:mm A'),
            endTimeFormatted: slotEndMoment.format('hh:mm A'),
            category,
            isAvailable,
            status: statusText
        });
    }

    return { isClosed: false, slots };
};

// ==========================================
// 🚑 5. REAL-TIME AMBULANCE AVAILABILITY CHECKER (For Booking Creation)
// ==========================================
const isAmbulanceAvailable = async (ambulanceId, targetDateTime, AmbulanceBookingModel, bufferMinutes = 120) => {
    try {
        const requestedStart = moment(targetDateTime);
        const requestedEnd = requestedStart.clone().add(bufferMinutes, 'minutes');

        // Active booking statuses jo trip block rakhti hain
        const activeStatuses = ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route', 'Searching'];

        // Overlap query check in database
        const conflictTrip = await AmbulanceBookingModel.findOne({
            ambulanceId,
            status: { $in: activeStatuses },
            $or: [
                {
                    createdAt: {
                        $gte: requestedStart.clone().subtract(bufferMinutes, 'minutes').toDate(),
                        $lte: requestedEnd.toDate()
                    }
                }
            ]
        });

        // Agar conflict mil gaya toh Ambulance unavailable hai
        return !conflictTrip;
    } catch (error) {
        console.error("isAmbulanceAvailable error:", error);
        return false;
    }
};

// ==========================================
// 👨‍⚕️ 6. DIABETES COACH SLOTS GENERATOR (With Premium Slots & Booking Collision)
// ==========================================
const generateCoachSlots = ({
    config = {},
    bookedAppointments = [],
    selectedDate,
    coachBasePrice = 0
}) => {
    const startTime = config.startTime || "09:00";
    const endTime = config.endTime || "20:00";
    const slotDuration = Number(config.slotDuration) || 30; // 30 mins default session
    const unavailableSlots = config.unavailableSlots || [];
    const offDays = config.offDays || [];
    const blockedDates = config.blockedDates || [];
    const premiumSlots = config.premiumSlots || []; // e.g. [{ time: "18:00", extraFee: 150 }]

    const morningSlots = config.morningSlots !== false;
    const afternoonSlots = config.afternoonSlots !== false;
    const eveningSlots = config.eveningSlots !== false;

    // 1. Off-Day & Blocked Date Check
    const dayName = moment(selectedDate).format('dddd');
    if (offDays.includes(dayName)) {
        return { isClosed: true, reason: `Coach is off on ${dayName}s.`, slots: [] };
    }
    if (blockedDates.includes(selectedDate)) {
        return { isClosed: true, reason: `Coach is unavailable on ${selectedDate}.`, slots: [] };
    }

    const slots = [];
    let [startHour, startMin] = startTime.split(':').map(Number);
    let [endHour, endMin] = endTime.split(':').map(Number);

    let startTotalMinutes = startHour * 60 + startMin;
    let endTotalMinutes = endHour * 60 + endMin;

    const isToday = moment().format('YYYY-MM-DD') === selectedDate;
    const currentMoment = moment();

    for (let minutes = startTotalMinutes; minutes + slotDuration <= endTotalMinutes; minutes += slotDuration) {
        const startH = Math.floor(minutes / 60);
        const startM = minutes % 60;
        const endMinutes = minutes + slotDuration;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;

        const timeString24 = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
        const slotStartMoment = moment(`${selectedDate} ${timeString24}`, 'YYYY-MM-DD HH:mm');
        const slotEndMoment = slotStartMoment.clone().add(slotDuration, 'minutes');

        const displayTime = `${slotStartMoment.format('hh:mm A')} - ${slotEndMoment.format('hh:mm A')}`;

        // Category Breakdown
        let category = "Morning";
        if (startH >= 12 && startH < 17) category = "Afternoon";
        else if (startH >= 17) category = "Evening";

        // Check Category Toggle
        const isCategoryEnabled = (category === "Morning" && morningSlots) ||
                                  (category === "Afternoon" && afternoonSlots) ||
                                  (category === "Evening" && eveningSlots);

        if (!isCategoryEnabled) continue;

        // 2. Past Time Check (If today)
        const isPast = isToday && slotStartMoment.isBefore(currentMoment);

        // 3. Admin Blocked Slot Check
        const isManuallyBlocked = unavailableSlots.includes(timeString24);

        // 4. Booking Conflict Check (Against confirmed bookings)
        const hasBookingConflict = bookedAppointments.some(appt => {
            const apptTime = appt.appointmentTime || appt.slotTime || appt.scheduledTime;
            return apptTime === timeString24 || apptTime === displayTime;
        });

        // 5. 💎 Premium Slot Calculation
        const premiumInfo = premiumSlots.find(p => p.time === timeString24);
        const isPremium = Boolean(premiumInfo && premiumInfo.extraFee > 0);
        const extraFee = isPremium ? Number(premiumInfo.extraFee) : 0;
        const totalPrice = Math.round(Number(coachBasePrice) + extraFee);

        let statusText = "Available";
        if (isPast) statusText = "Past";
        else if (isManuallyBlocked) statusText = "Unavailable";
        else if (hasBookingConflict) statusText = "Booked";

        const isAvailable = !isPast && !isManuallyBlocked && !hasBookingConflict;

        slots.push({
            slotTime: timeString24, // e.g. "18:00"
            displayTime,           // e.g. "06:00 PM - 06:30 PM"
            category,              // "Morning" | "Afternoon" | "Evening"
            isPremium,
            extraFee,              // e.g. 150 (₹)
            basePrice: Number(coachBasePrice),
            totalPrice,            // e.g. 499 + 150 = 649 (₹)
            isAvailable,
            status: statusText     // "Available" | "Booked" | "Past" | "Unavailable"
        });
    }

    return { isClosed: false, slots };
};


module.exports = { 
    generateTimeSlots, 
    generateFoodSlots, 
    isFoodAvailable,
    generateAmbulanceSlots,
    isAmbulanceAvailable,
    generateCoachSlots,
    
};