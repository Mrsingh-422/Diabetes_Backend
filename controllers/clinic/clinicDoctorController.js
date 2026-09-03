// controllers/clinic/clinicDoctor/clinicDoctorController.js
const Doctor = require('../../models/Doctor');
const Clinic = require('../../models/Clinic');
const bcrypt = require('bcryptjs');
const { deleteFile } = require('../../utils/fileHandler'); // 👈 Old file cleanup helper

// --- UPDATE CLINIC DOCTOR ---
// Endpoint: PUT /api/clinic/doctors/update/:id
const updateClinicDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;
        const files = req.files || {};
        const updates = { ...req.body };

        // 1. Doctor verify karein ki isi clinic ka hai
        const doctor = await Doctor.findOne({ _id: id, clinicId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found or unauthorized in your clinic."
            });
        }

        // 2. Agar email update ho raha hai toh uniqueness check karein
        if (updates.email && updates.email.toLowerCase() !== doctor.email) {
            const emailExists = await Doctor.findOne({ _id: { $ne: id }, email: updates.email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({ success: false, message: "This email is already in use by another doctor." });
            }
            doctor.email = updates.email.toLowerCase();
        }

        // 3. Agar phone update ho raha hai toh uniqueness check karein
        if (updates.phone && updates.phone !== doctor.phone) {
            const phoneExists = await Doctor.findOne({ _id: { $ne: id }, phone: updates.phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: "This phone number is already registered." });
            }
            doctor.phone = updates.phone;
        }

        // 4. Update basic text fields
        if (updates.name) doctor.name = updates.name.startsWith('Dr.') ? updates.name : `Dr. ${updates.name}`;
        if (updates.altPhone !== undefined) doctor.alternatePhone = updates.altPhone;
        if (updates.gender) doctor.gender = updates.gender;
        if (updates.specialist) doctor.speciality = updates.specialist;
        if (updates.experience !== undefined) doctor.experienceYears = Number(updates.experience);
        if (updates.licenseNumber) doctor.licenseNumber = updates.licenseNumber;
        if (updates.councilName !== undefined) doctor.councilName = updates.councilName;
        if (updates.address !== undefined) doctor.address = updates.address;
        if (updates.city !== undefined) doctor.city = updates.city;
        if (updates.state !== undefined) doctor.state = updates.state;
        if (updates.pincode !== undefined) doctor.pincode = updates.pincode;

        // Location GPS
        if (updates.latitude !== undefined || updates.longitude !== undefined) {
            doctor.location = {
                lat: updates.latitude ? Number(updates.latitude) : doctor.location?.lat || 0,
                lng: updates.longitude ? Number(updates.longitude) : doctor.location?.lng || 0
            };
        }

        // Consultation Fee
        if (updates.consultationFee !== undefined) {
            doctor.fees = {
                ...doctor.fees,
                clinic: Number(updates.consultationFee)
            };
        }

        // Password change (optional)
        if (updates.password) {
            doctor.password = await bcrypt.hash(String(updates.password), 10);
        }

        // Qualifications JSON array
        if (updates.qualifications) {
            try {
                const parsedQualifications = typeof updates.qualifications === 'string'
                    ? JSON.parse(updates.qualifications)
                    : updates.qualifications;

                if (Array.isArray(parsedQualifications) && parsedQualifications.length > 0) {
                    doctor.qualification = parsedQualifications.map(q => q.degree).filter(Boolean).join(', ');
                    doctor.qualifications = parsedQualifications;
                }
            } catch (err) {
                console.warn("Qualifications parse error during update:", err.message);
            }
        }

        // 5. File uploads & Purani file disk cleanup
        if (files.profileImage && files.profileImage.length > 0) {
            if (doctor.profileImage) deleteFile(doctor.profileImage); // Purani profile pic delete karein
            doctor.profileImage = `/uploads/doctors/${files.profileImage[0].filename}`;
        }

        if (files.signature && files.signature.length > 0) {
            if (doctor.signatureImage) deleteFile(doctor.signatureImage); // Purani signature delete karein
            doctor.signatureImage = `/uploads/doctors/${files.signature[0].filename}`;
        }

        // Additional documents
        if (files.licenseCert && files.licenseCert.length > 0) {
            doctor.documents.push(`/uploads/doctors/${files.licenseCert[0].filename}`);
        }
        if (files.idProof && files.idProof.length > 0) {
            doctor.documents.push(`/uploads/doctors/${files.idProof[0].filename}`);
        }
        if (files.degreeCertificates && files.degreeCertificates.length > 0) {
            files.degreeCertificates.forEach(f => {
                doctor.documents.push(`/uploads/doctors/${f.filename}`);
            });
        }

        await doctor.save();

        res.json({
            success: true,
            message: `Dr. ${doctor.name.replace(/^Dr\.\s*/, '')} profile updated successfully.`,
            data: doctor
        });

    } catch (error) {
        console.error("Update Clinic Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1. REGISTER NEW CLINIC DOCTOR ---
// Endpoint: POST /api/clinic/doctors/add
const addClinicDoctor = async (req, res) => {
    try {
        const clinicId = req.user.id; // From protect('clinic')
        const files = req.files || {};
        
        const {
            name,
            email,
            phone,
            altPhone,
            gender,
            consultationFee,
            specialist,
            experience,
            licenseNumber,
            councilName,
            address,
            city,
            state,
            pincode,
            latitude,
            longitude,
            password,
            qualifications // JSON string array from frontend: [{ degree, college, year }]
        } = req.body;

        // 1. Mandatory validations
        if (!name || !phone || !specialist || !licenseNumber) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required fields: Name, Phone, Specialization, and License Number."
            });
        }

        // 2. Check if doctor already exists with same email or phone
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });

        const existingDoctor = await Doctor.findOne({ $or: query });
        if (existingDoctor) {
            return res.status(400).json({
                success: false,
                message: "A doctor with this Email or Phone number already exists in the system."
            });
        }

        // 3. Process File Uploads
        const profileImagePath = files.profileImage?.[0] 
            ? `/uploads/doctors/${files.profileImage[0].filename}` 
            : null;

        const signatureImagePath = files.signature?.[0] 
            ? `/uploads/doctors/${files.signature[0].filename}` 
            : null;

        const documentPaths = [];
        if (files.licenseCert?.[0]) {
            documentPaths.push(`/uploads/doctors/${files.licenseCert[0].filename}`);
        }
        if (files.idProof?.[0]) {
            documentPaths.push(`/uploads/doctors/${files.idProof[0].filename}`);
        }
        if (files.degreeCertificates && files.degreeCertificates.length > 0) {
            files.degreeCertificates.forEach(f => {
                documentPaths.push(`/uploads/doctors/${f.filename}`);
            });
        }

        // 4. Parse Qualifications from JSON if provided
        let parsedQualifications = [];
        let primaryDegreeString = "MBBS";

        if (qualifications) {
            try {
                parsedQualifications = typeof qualifications === 'string' 
                    ? JSON.parse(qualifications) 
                    : qualifications;

                if (Array.isArray(parsedQualifications) && parsedQualifications.length > 0) {
                    // Extract degrees string e.g. "MBBS, MD, Fellowship"
                    primaryDegreeString = parsedQualifications.map(q => q.degree).filter(Boolean).join(', ');
                }
            } catch (err) {
                console.warn("Could not parse qualifications JSON, using raw string");
            }
        }

        // 5. Default Password Hash (Doctor can login or reset later)
        const rawPassword = password || phone || 'Doctor@123';
        const hashedPassword = await bcrypt.hash(String(rawPassword), 10);

        // 6. Create Doctor Record
        const newDoctor = await Doctor.create({
            clinicId: clinicId,
            name: name.startsWith('Dr.') ? name : `Dr. ${name}`,
            email: email ? email.toLowerCase() : undefined,
            phone,
            alternatePhone: altPhone || null,
            password: hashedPassword,
            role: 'clinic-doctor',

            // Location
            address: address || null,
            city: city || null,
            state: state || null,
            country: 'India',
            location: {
                lat: latitude ? Number(latitude) : 0,
                lng: longitude ? Number(longitude) : 0
            },

            // Professional Profile
            speciality: specialist,
            qualification: primaryDegreeString,
            experienceYears: experience ? Number(experience) : 0,
            licenseNumber: licenseNumber,
            councilName: councilName || null,
            councilNumber: licenseNumber,

            // Fees
            fees: {
                clinic: consultationFee ? Number(consultationFee) : 0,
                online: 0,
                home: 0
            },
            consultationStatus: {
                clinic: true,
                online: false,
                home: false
            },

            // Media
            profileImage: profileImagePath,
            signatureImage: signatureImagePath,
            documents: documentPaths,

            // Status
            profileStatus: 'Approved', // Clinic-added doctors are pre-approved
            dutyStatus: 'On Duty',
            isActive: true,
            isOnline: true
        });

        // 7. Link Doctor into Clinic model DoctorId array
        await Clinic.findByIdAndUpdate(clinicId, {
            $addToSet: { DoctorId: newDoctor._id }
        });

        res.status(201).json({
            success: true,
            message: `${newDoctor.name} has been successfully registered to your clinic.`,
            data: newDoctor
        });

    } catch (error) {
        console.error("Add Clinic Doctor Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to register doctor"
        });
    }
};

// --- 2. GET ALL DOCTORS OF THE LOGGED-IN CLINIC ---
// Endpoint: GET /api/clinic/doctors/my-doctors
const getMyClinicDoctors = async (req, res) => {
    try {
        const clinicId = req.user.id;
        const doctors = await Doctor.find({ clinicId }).sort({ createdAt: -1 });

        res.json({
            success: true,
            count: doctors.length,
            data: doctors
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. TOGGLE DOCTOR DUTY STATUS ---
// Endpoint: PATCH /api/clinic/doctors/:id/duty-status
const toggleDoctorDutyStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { dutyStatus } = req.body; // 'On Duty' | 'Off Duty' | 'On Leave' | 'Busy'

        const doctor = await Doctor.findOneAndUpdate(
            { _id: id, clinicId: req.user.id },
            { $set: { dutyStatus } },
            { new: true }
        );

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in your clinic." });
        }

        res.json({
            success: true,
            message: `Dr. ${doctor.name} is now ${dutyStatus}`,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. REMOVE DOCTOR FROM CLINIC ---
// Endpoint: DELETE /api/clinic/doctors/:id
const removeClinicDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.id;

        const doctor = await Doctor.findOneAndDelete({ _id: id, clinicId });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or unauthorized." });
        }

        // Unlink from Clinic
        await Clinic.findByIdAndUpdate(clinicId, {
            $pull: { DoctorId: id }
        });

        res.json({
            success: true,
            message: "Doctor removed from clinic successfully."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    addClinicDoctor,
    getMyClinicDoctors,
    toggleDoctorDutyStatus,
    removeClinicDoctor,
    updateClinicDoctor
};