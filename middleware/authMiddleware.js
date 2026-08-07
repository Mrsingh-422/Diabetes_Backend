const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Doctor = require('../models/Doctor');

const Lab = require('../models/Lab');
const Pharmacy = require('../models/Pharmacy');
const Food = require('../models/Food');
const Driver = require('../models/Driver');
const Tab = require('../models/Tab'); // Tab model for global tab status check



1. // Verify Token & Identify User Type

const protect = (modelType) => async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // --- Development Mode: No Expiry Check ---
            const verifyOptions = process.env.NODE_ENV === 'development' ? { ignoreExpiration: true } : {};
            const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);

            let user;
            
            // FIX: Normalize modelType to single string if passed as an array (for role matching)
            let activeModelType;
            if (Array.isArray(modelType)) {
                // Agar array hai toh check karenge token role isme exist karta hai ya nahi, fallback to first index
                activeModelType = modelType.includes(decoded.role) ? decoded.role : modelType[0];
            } else {
                activeModelType = modelType;
            }

            // Model Selection Logic based on resolved activeModelType
            switch (activeModelType) {
                case 'admin':
                    user = await Admin.findById(decoded.id).populate('roleType');
                    break;
                case 'user':
                    user = await User.findById(decoded.id);
                    break;
                case 'doctor':
                case 'hospital-doctor':
                    user = await Doctor.findById(decoded.id);
                
                    break;
                case 'lab':
                    user = await Lab.findById(decoded.id);
                    break;
                case 'pharmacy':
                    user = await Pharmacy.findById(decoded.id);
                    break;
                case 'Food':
                    user = await Food.findById(decoded.id);
                    break;
                case 'driver':
                    user = await Driver.findById(decoded.id);
                    break;
                case 'provider':
                    user = await Lab.findById(decoded.id) || 
                           await Pharmacy.findById(decoded.id) || 
                           await Food.findById(decoded.id);
                    break;
                
                    
                
                    break;

                default:
                    return res.status(400).json({ message: 'Invalid Model Type in Middleware' });
            }

            if (!user) return res.status(401).json({ message: 'User not found' });

            // --- Deactivation Check (Common for all) ---
            if (user.isActive === false) {
                return res.status(403).json({ message: 'Account is deactivated' });
            }

            req.user = user; 
            next();
        } catch (error) {
            console.error("Auth Error:", error.message);
            res.status(401).json({ message: 'Not authorized, invalid token' });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// 2. PHP Style Tab ID Check (SQL IDs like 1, 28, 31...)
// const checkRoleAccess = (tabId) => {
//     return async (req, res, next) => {
//         try {
           
//             if (req.user.role === 'superadmin') return next();
 
       
//             const Tab = require('../models/Tab');
//             const globalTab = await Tab.findOne({ tabId: Number(tabId), isActive: true });
//             if (!globalTab) return res.status(403).json({ message: "This module is temporarily disabled by Admin" });
 
       
//             const roleTypes = req.user.roleType;
           
       
//             if (!roleTypes || !Array.isArray(roleTypes) || roleTypes.length === 0) {
//                 return res.status(403).json({ message: "Access Denied: No Role Assigned" });
//             }
 
           
//             let allAllowedTabs = [];
//             roleTypes.forEach(role => {
//                 if (role && role.tabIds) {
//                     allAllowedTabs.push(...role.tabIds);
//                 }
//             });
 
       
//             const hasAccess = allAllowedTabs.includes(Number(tabId));
           
//             if (!hasAccess) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Access Denied: You do not have permission for this module."
//                 });
//             }
           
//             next(); // Access Granted!
//         } catch (error) {
//             res.status(500).json({ message: error.message });
//         }
//     };
// };
 
const checkRoleAccess = (tabId) => {
    return async (req, res, next) => {
        try {
            // 1. Superadmin bypass
            if (req.user.role === 'superadmin') return next();

            // 2. Global active check
            const Tab = require('../models/Tab'); 
            const globalTab = await Tab.findOne({ tabId: Number(tabId), isActive: true });
            if (!globalTab) return res.status(403).json({ message: "This module is temporarily disabled by Admin" });

            const roleTypeData = req.user.roleType;
            
            if (!roleTypeData) {
                return res.status(403).json({ message: "Access Denied: No Role Assigned" });
            }

            let allAllowedTabs = [];

            // HYBRID LOGIC: Array aur Single Object dono ke liye taiyar hai
            if (Array.isArray(roleTypeData)) {
                // Case A: Agar multiple roles (Array) hain, toh loop chalayenge
                roleTypeData.forEach(role => {
                    if (role && role.tabIds) {
                        allAllowedTabs.push(...role.tabIds);
                    }
                });
            } else if (roleTypeData.tabIds) {
                // Case B: Agar single role (Object) hai, toh direct permissions utha lenge
                allAllowedTabs = roleTypeData.tabIds;
            }

            // Check access
            const hasAccess = allAllowedTabs.includes(Number(tabId));
            
            if (!hasAccess) {
                return res.status(403).json({ 
                    success: false, 
                    message: "Access Denied: You do not have permission for this module." 
                });
            }
            
            next(); // Access Granted!
        } catch (error) { 
            res.status(500).json({ message: error.message }); 
        }
    };
};


// 3. Location Filter Helper (For Controller use)
const getLocationFilter = (req) => {
    // SuperAdmin can see everything
    if (req.user.role === 'superadmin') return {};

    const access = req.user.locationAccess;
    if (!access) return {}; // Default empty filter if no location restricted

    let filter = {};
    if (access.country) filter.country = access.country;
    if (access.state) filter.state = access.state;
    if (access.city) filter.city = access.city;
    
    return filter;
};


module.exports = { protect, checkRoleAccess, getLocationFilter };