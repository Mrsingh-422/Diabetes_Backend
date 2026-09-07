// controllers/clinic/clinicAmbulanceController.js
const Ambulance = require('../../models/Ambulance');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const Clinic = require('../../models/Clinic');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// Helper: Generate JWT Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// 1. ADD AMBULANCE (With isAmbulanceAvailable & Support Staff check)
// Endpoint: POST /api/clinic/ambulance/add
// ==========================================
const addClinicAmbulance = async (req, res) => {
    try {
        const clinicId = req.user.id;

        // 🛡️ 1. Check if Clinic has Ambulance Service Enabled
        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic profile not found." });
        }

        if (clinic.isAmbulanceAvailable !== true) {
            return res.status(403).json({
                success: false,
                message: "Ambulance facility is disabled for your clinic. Please enable 'isAmbulanceAvailable' in clinic settings/profile first."
            });
        }

        const {
            name,
            email,
            phone,
            password,
            address,
            city,
            state,
            country = 'India',
            vehicleNumber,
            vehicleType = 'Van',
            drivingLicenseNumber,
            rcNumber,
            insuranceNumber,
            bloodGroup,
            experienceYears,
            serviceRadius = '15 km',
            singleRidePrice = 400,
            doubleRidePrice = 700,
            baseDistance = 5,
            pricePerKM = 12,
            latitude = 0,
            longitude = 0,

            // 👇 Support Staff Fields
            hasNurse = false,
            nursePrice = 0,
            hasDoctor = false,
            doctorPrice = 0,
            supportStaff
        } = req.body;

        // Validations
        if (!name || !phone || !vehicleNumber) {
            return res.status(400).json({
                success: false,
                message: "Driver Name, Phone Number, and Vehicle Number are required."
            });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: "Password is required." });
        }

        const cleanVehicleNumber = vehicleNumber.toUpperCase().trim();
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });
        if (vehicleNumber) query.push({ vehicleNumber: cleanVehicleNumber });

        const exists = await Ambulance.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({
                success: false,
                message: "Ambulance with this Phone, Email, or Vehicle Number already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);

        // Uploaded files
        const files = req.files || {};
        const getPath = (key) => (files[key] && files[key][0] ? `/uploads/ambulances/${files[key][0].filename}` : null);

        const documents = {
            drivingLicenseFile: getPath('drivingLicenseFile'),
            rcFile: getPath('rcFile'),
            insuranceFile: getPath('insuranceFile'),
            fitnessCertificate: getPath('fitnessCertificate'),
            ambulancePermit: getPath('ambulancePermit')
        };

        // Support Staff Structure Builder
        const supportStaffData = {
            nurse: {
                available: hasNurse === 'true' || hasNurse === true || Boolean(supportStaff?.nurse?.available),
                price: Number(nursePrice ?? supportStaff?.nurse?.price ?? 0)
            },
            doctor: {
                available: hasDoctor === 'true' || hasDoctor === true || Boolean(supportStaff?.doctor?.available),
                price: Number(doctorPrice ?? supportStaff?.doctor?.price ?? 0)
            }
        };

        // 2. Create Ambulance with 'Pending' Status
        const newAmbulance = await Ambulance.create({
            clinicId,
            name,
            email: email ? email.toLowerCase() : undefined,
            phone,
            password: hashedPassword,
            role: 'clinic-ambulance',
            country,
            state,
            city,
            address,
            vehicleNumber: cleanVehicleNumber,
            vehicleType,
            drivingLicenseNumber,
            rcNumber,
            insuranceNumber,
            bloodGroup,
            experienceYears,
            serviceRadius,
            availableForEmergency: false,
            isActive: true,
            isOnline: false,
            profileStatus: 'Pending',

            supportStaff: supportStaffData,

            pricing: {
                singleRidePrice: Number(singleRidePrice),
                doubleRidePrice: Number(doubleRidePrice),
                baseDistance: Number(baseDistance),
                pricePerKM: Number(pricePerKM)
            },

            location: {
                lat: Number(latitude),
                lng: Number(longitude)
            },

            documents
        });

        const clinicName = clinic.clinicName || clinic.name || "Clinic";

        // 3. 🚀 Create Admin Approval Request
        await ProfileUpdateRequest.create({
            vendorId: newAmbulance._id,
            vendorModel: 'Ambulance',
            updatedFields: {
                name: newAmbulance.name,
                phone: newAmbulance.phone,
                email: newAmbulance.email,
                vehicleNumber: newAmbulance.vehicleNumber,
                vehicleType: newAmbulance.vehicleType,
                supportStaff: supportStaffData,
                pricing: newAmbulance.pricing,
                serviceRadius: newAmbulance.serviceRadius,
                clinicId: clinicId,
                clinicName: clinicName,
                documents: documents
            },
            status: 'Pending'
        });

        // 4. 🔔 Notify Admin
        try {
            await notifyAdminsAndVendor(
                newAmbulance._id,
                'ambulance',
                "New Clinic Ambulance Approval Request",
                `${clinicName} has registered Ambulance (${newAmbulance.vehicleNumber}) with medical support staff. Please review for approval.`
            );
        } catch (notifErr) {
            console.error("Admin Notification error on ambulance registration:", notifErr.message);
        }

        const responseData = newAmbulance.toObject();
        delete responseData.password;
        delete responseData.hospitalId;

        res.status(201).json({
            success: true,
            message: `Ambulance '${newAmbulance.vehicleNumber}' registered successfully and submitted to Admin for approval.`,
            profileStatus: 'Pending',
            data: responseData
        });

    } catch (error) {
        console.error("Add Clinic Ambulance Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. UPDATE AMBULANCE (With Support Staff)
// Endpoint: PUT /api/clinic/ambulance/update/:id
// ==========================================
const updateClinicAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = { ...req.body };

        const ambulance = await Ambulance.findOne({ _id: id, clinicId });
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found or unauthorized." });
        }

        // Basic Info Updates
        if (updates.name) ambulance.name = updates.name;
        if (updates.address !== undefined) ambulance.address = updates.address;
        if (updates.city !== undefined) ambulance.city = updates.city;
        if (updates.state !== undefined) ambulance.state = updates.state;
        if (updates.vehicleType) ambulance.vehicleType = updates.vehicleType;
        if (updates.vehicleNumber) ambulance.vehicleNumber = updates.vehicleNumber.toUpperCase().trim();
        if (updates.drivingLicenseNumber !== undefined) ambulance.drivingLicenseNumber = updates.drivingLicenseNumber;
        if (updates.rcNumber !== undefined) ambulance.rcNumber = updates.rcNumber;
        if (updates.insuranceNumber !== undefined) ambulance.insuranceNumber = updates.insuranceNumber;
        if (updates.bloodGroup !== undefined) ambulance.bloodGroup = updates.bloodGroup;
        if (updates.experienceYears !== undefined) ambulance.experienceYears = updates.experienceYears;
        if (updates.serviceRadius !== undefined) ambulance.serviceRadius = updates.serviceRadius;
        if (updates.availableForEmergency !== undefined) ambulance.availableForEmergency = updates.availableForEmergency === 'true' || updates.availableForEmergency === true;

        // Support Staff Update
        if (updates.hasNurse !== undefined || updates.nursePrice !== undefined || updates.hasDoctor !== undefined || updates.doctorPrice !== undefined) {
            if (!ambulance.supportStaff) {
                ambulance.supportStaff = { nurse: { available: false, price: 0 }, doctor: { available: false, price: 0 } };
            }
            if (updates.hasNurse !== undefined) ambulance.supportStaff.nurse.available = updates.hasNurse === 'true' || updates.hasNurse === true;
            if (updates.nursePrice !== undefined) ambulance.supportStaff.nurse.price = Number(updates.nursePrice);
            if (updates.hasDoctor !== undefined) ambulance.supportStaff.doctor.available = updates.hasDoctor === 'true' || updates.hasDoctor === true;
            if (updates.doctorPrice !== undefined) ambulance.supportStaff.doctor.price = Number(updates.doctorPrice);
        }

        // Pricing Updates
        if (updates.singleRidePrice !== undefined || updates.doubleRidePrice !== undefined || updates.baseDistance !== undefined || updates.pricePerKM !== undefined) {
            ambulance.pricing = {
                singleRidePrice: updates.singleRidePrice !== undefined ? Number(updates.singleRidePrice) : ambulance.pricing.singleRidePrice,
                doubleRidePrice: updates.doubleRidePrice !== undefined ? Number(updates.doubleRidePrice) : ambulance.pricing.doubleRidePrice,
                baseDistance: updates.baseDistance !== undefined ? Number(updates.baseDistance) : ambulance.pricing.baseDistance,
                pricePerKM: updates.pricePerKM !== undefined ? Number(updates.pricePerKM) : ambulance.pricing.pricePerKM
            };
        }

        // File Updates
        const docKeys = ['drivingLicenseFile', 'rcFile', 'insuranceFile', 'fitnessCertificate', 'ambulancePermit'];
        docKeys.forEach(key => {
            if (files[key] && files[key][0]) {
                if (ambulance.documents && ambulance.documents[key]) {
                    deleteFile(ambulance.documents[key]);
                }
                if (!ambulance.documents) ambulance.documents = {};
                ambulance.documents[key] = `/uploads/ambulances/${files[key][0].filename}`;
            }
        });

        await ambulance.save();

        const responseData = ambulance.toObject();
        delete responseData.password;
        delete responseData.hospitalId;

        res.json({
            success: true,
            message: `Ambulance '${ambulance.vehicleNumber}' updated successfully.`,
            data: responseData
        });

    } catch (error) {
        console.error("Update Clinic Ambulance Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET ALL AMBULANCES OF LOGGED-IN CLINIC
// Endpoint: GET /api/clinic/ambulance/my-ambulances
// ==========================================
const getMyClinicAmbulances = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const ambulances = await Ambulance.find({ clinicId })
            .select(' -password') // 👈 hospitalId exclude
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: ambulances.length,
            data: ambulances
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 4. TOGGLE EMERGENCY DUTY STATUS
// Endpoint: PATCH /api/clinic/ambulance/toggle-status/:id
// ==========================================
const toggleClinicAmbulanceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const ambulance = await Ambulance.findOne({ _id: id, clinicId });
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        ambulance.availableForEmergency = !ambulance.availableForEmergency;
        await ambulance.save();

        res.json({
            success: true,
            message: `Ambulance is now ${ambulance.availableForEmergency ? 'Available for Emergency' : 'On Duty / Busy'}`,
            availableForEmergency: ambulance.availableForEmergency
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. DELETE AMBULANCE
// Endpoint: DELETE /api/clinic/ambulance/delete/:id
// ==========================================
const deleteClinicAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const ambulance = await Ambulance.findOne({ _id: id, clinicId });
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found or unauthorized." });
        }

        // Delete associated documents from disk
        if (ambulance.documents) {
            Object.values(ambulance.documents).forEach(filePath => {
                if (filePath) deleteFile(filePath);
            });
        }

        await Ambulance.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "Ambulance and documents removed successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. LOGIN CLINIC AMBULANCE DRIVER
// Endpoint: POST /api/clinic/ambulance/login
// ==========================================
const loginClinicAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const ambulance = await Ambulance.findOne(query).select('+password');
        if (!ambulance || !(await bcrypt.compare(String(password), ambulance.password))) {
            return res.status(400).json({ success: false, message: "Invalid Credentials" });
        }

        if (ambulance.isActive === false) {
            return res.status(403).json({ success: false, message: "Your ambulance account has been deactivated." });
        }

        let token = (process.env.NODE_ENV === 'development') ? ambulance.token : null;
        if (!token) {
            token = generateToken(ambulance._id, ambulance.role);
            ambulance.token = token;
            await ambulance.save();
        }

        ambulance.password = undefined;

        res.json({
            success: true,
            message: "Login successful",
            token,
            role: ambulance.role,
            data: ambulance
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    addClinicAmbulance,
    getMyClinicAmbulances,
    updateClinicAmbulance,
    toggleClinicAmbulanceStatus,
    deleteClinicAmbulance,
    loginClinicAmbulance
};