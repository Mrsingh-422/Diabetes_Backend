// utils/helpers.js
const axios = require('axios');

// ==========================================
// 💡 PURE HAVERSINE FORMULA (Straight Line Distance Engine)
// ==========================================
const calculateHaversine = (lat1, lon1, lat2, lon2) => {
    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371; // Earth Radius in KM
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2)); // Returns KM
};

// ==========================================
// 1. UNIFIED DISTANCE CALCULATOR (Google Map with Haversine Fallback)
// ==========================================
const getDistance = async (userLat, userLng, vendorLat, vendorLng) => {
    const uLat = Number(userLat);
    const uLng = Number(userLng);
    const vLat = Number(vendorLat);
    const vLng = Number(vendorLng);

    if (!uLat || !uLng || !vLat || !vLng) {
        return 0;
    }

    // DEVELOPMENT MODE ya Google Key Na Hone Par: Use Haversine
    if (process.env.NODE_ENV === 'development' || !process.env.GOOGLE_MAPS_API_KEY) {
        return calculateHaversine(uLat, uLng, vLat, vLng);
    }

    // PRODUCTION MODE: Use Google Distance Matrix API
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${uLat},${uLng}&destinations=${vLat},${vLng}&key=${apiKey}`;
        
        const response = await axios.get(url);
        const element = response.data?.rows?.[0]?.elements?.[0];

        if (element && element.status === 'OK' && element.distance?.value !== undefined) {
            return parseFloat((element.distance.value / 1000).toFixed(2)); // Convert Meters to KM
        }

        // Agar Google API element OK na ho toh Haversine use karo
        return calculateHaversine(uLat, uLng, vLat, vLng);
    } catch (error) {
        // 🚨 FIXED: Ab ye 0 return nahi karega, Haversine calculate karega!
        return calculateHaversine(uLat, uLng, vLat, vLng);
    }
};

// ==========================================
// 2. RAZORPAY CONFIG (Dev vs Prod)
// ==========================================
const getRazorpayKeys = () => {
    if (process.env.NODE_ENV === 'production') {
        return {
            key_id: process.env.RAZORPAY_LIVE_KEY_ID,
            key_secret: process.env.RAZORPAY_LIVE_KEY_SECRET
        };
    } else {
        return {
            key_id: process.env.RAZORPAY_TEST_KEY_ID,
            key_secret: process.env.RAZORPAY_TEST_KEY_SECRET
        };
    }
};

module.exports = { getDistance, getRazorpayKeys, calculateHaversine };



// // utils/helpers.js
// const axios = require('axios');

// // ==========================================
// // 1. DISTANCE CALCULATOR (Google Map vs Straight Line)
// // ==========================================
// const getDistance = async (userLat, userLng, vendorLat, vendorLng) => {
//     // DEVELOPMENT MODE: Use Haversine (Straight Line) Formula
//     if (process.env.NODE_ENV === 'development') {
//         const toRad = (value) => (value * Math.PI) / 180;
//         const R = 6371; // Earth Radius in KM
//         const dLat = toRad(vendorLat - userLat);
//         const dLon = toRad(vendorLng - userLng);
//         const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
//                   Math.cos(toRad(userLat)) * Math.cos(toRad(vendorLat)) *
//                   Math.sin(dLon / 2) * Math.sin(dLon / 2);
//         const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//         return parseFloat((R * c).toFixed(2)); // Returns KM
//     }

//     // PRODUCTION MODE: Use Google Distance Matrix API
//     try {
//         const apiKey = process.env.GOOGLE_MAPS_API_KEY;
//         const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userLat},${userLng}&destinations=${vendorLat},${vendorLng}&key=${apiKey}`;
        
//         const response = await axios.get(url);
//         const distanceText = response.data.rows[0].elements[0].distance.value; // Returns meters
//         return parseFloat((distanceText / 1000).toFixed(2)); // Convert to KM
//     } catch (error) {
//         console.error("Map API Error, falling back to Haversine");
//         return 0; 
//     }
// };

// // ==========================================
// // 2. RAZORPAY CONFIG (Dev vs Prod)
// // ==========================================
// const getRazorpayKeys = () => {
//     if (process.env.NODE_ENV === 'production') {
//         return {
//             key_id: process.env.RAZORPAY_LIVE_KEY_ID,
//             key_secret: process.env.RAZORPAY_LIVE_KEY_SECRET
//         };
//     } else {
//         return {
//             key_id: process.env.RAZORPAY_TEST_KEY_ID,
//             key_secret: process.env.RAZORPAY_TEST_KEY_SECRET
//         };
//     }
// };

// module.exports = { getDistance, getRazorpayKeys };