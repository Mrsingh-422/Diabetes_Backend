const Admin = require("../../models/Admin");

const Doctor = require("../../models/Doctor");

const User = require("../../models/User");

const Lab = require("../../models/Lab");

const Pharmacy = require("../../models/Pharmacy");

const Food = require("../../models/Food");

const Driver = require("../../models/Driver");

const bcrypt = require("bcryptjs");

const crypto = require("crypto");

const admin = require("firebase-admin"); // Firebase Admin SDK integration

const { sendEmailOTP } = require("../../utils/emailService");
 
// List of all active models in the system

const getActiveModels = () => {

    return [Admin, Doctor,  User, Lab, Pharmacy, Food, Driver];

};
 
// Helper: Safely find account by Email across all models

const findAccountByEmail = async (email) => {

    const models = getActiveModels();

    const cleanEmail = email.toLowerCase().trim();

    for (let Model of models) {

        const account = await Model.findOne({ email: cleanEmail });

        if (account) return { account, Model };

    }

    return null;

};
 
// Helper: Safely find account by Phone across all models

const findAccountByPhone = async (phone) => {

    const models = getActiveModels();

    const cleanPhone = phone.trim();

    for (let Model of models) {

        const account = await Model.findOne({ phone: cleanPhone });

        if (account) return { account, Model };

    }

    return null;

};
 
// Helper: Dynamically set OTP & Expiry fields based on Model Schema Paths (Prevents validation crashes)

const setResetOTPFields = async (account, Model, otp, expiryTime) => {

    const updateFields = {};

    // Check if schema has resetPasswordOtp or resetOTP

    if (Model.schema.paths.resetPasswordOtp || Model.schema.paths.resetPasswordOtp === undefined) {

        updateFields.resetPasswordOtp = otp;

    }

    if (Model.schema.paths.resetOTP) {

        updateFields.resetOTP = otp;

    }

    if (Model.schema.paths.resetPasswordExpires) {

        updateFields.resetPasswordExpires = expiryTime;

    }
 
    return await Model.findByIdAndUpdate(account._id, { $set: updateFields }, { new: true });

};
 
// Helper: Dynamically clear OTP & Expiry fields after password change

const clearResetOTPFields = async (accountId, Model) => {

    const updateFields = {};

    if (Model.schema.paths.resetPasswordOtp || Model.schema.paths.resetPasswordOtp === undefined) {

        updateFields.resetPasswordOtp = null;

    }

    if (Model.schema.paths.resetOTP) {

        updateFields.resetOTP = null;

    }

    if (Model.schema.paths.resetPasswordExpires) {

        updateFields.resetPasswordExpires = null;

    }

    await Model.findByIdAndUpdate(accountId, { $set: updateFields });

};
 
// =========================================================================

// ✉️ EMAIL FLOW (Dynamic & Cleaned)

// =========================================================================
 
// A. FORGOT PASSWORD - SEND EMAIL OTP

const forgotPassword = async (req, res) => {

    try {

        const { email } = req.body;

        if (!email) return res.status(400).json({ success: false, message: "Email is required" });
 
        const result = await findAccountByEmail(email);

        if (!result) {

            return res.status(404).json({ success: false, message: "Account not found with this email" });

        }
 
        const { account, Model } = result;
 
        let otp;

        let isProduction = process.env.NODE_ENV === 'production';
 
        if (isProduction) {

            otp = Math.floor(1000 + Math.random() * 9000).toString();

        } else {

            otp = "1111";

        }
 
        const expiryTime = Date.now() + 10 * 60 * 1000; // 10 mins

        await setResetOTPFields(account, Model, otp, expiryTime);
 
        console.log(`[${process.env.NODE_ENV || 'development'}] Email OTP for ${email} is: ${otp}`);
 
        if (isProduction) {

            const emailSent = await sendEmailOTP(email, otp);

            if (emailSent) {

                return res.json({ success: true, message: "OTP sent to your email" });

            }

        }
 
        res.json({ 

            success: true, 

            message: isProduction 

                ? "OTP generated (Email failed, check server console)" 

                : "Development Mode: Use static OTP 1111",

            testOtp: isProduction ? undefined : otp 

        });
 
    } catch (error) {

        console.error("Forgot Password Email Error:", error);

        res.status(500).json({ success: false, message: error.message });

    }

};
 
// B. VERIFY EMAIL OTP

const verifyOtp = async (req, res) => {

    try {

        const { email, otp } = req.body;

        if (!email || !otp) return res.status(400).json({ success: false, message: "Email and OTP are required" });
 
        const models = getActiveModels();

        let account = null;
 
        for (let Model of models) {

            // Evaluates both potential schema paths for verification

            const query = {

                email: email.toLowerCase().trim(),

                $or: [

                    { resetPasswordOtp: otp },

                    { resetOTP: otp }

                ],

                resetPasswordExpires: { $gt: Date.now() }

            };
 
            account = await Model.findOne(query);

            if (account) break;

        }
 
        if (!account) {

            return res.status(400).json({ success: false, message: "Invalid or Expired OTP" });

        }
 
        res.json({ success: true, message: "OTP Verified Successfully" });
 
    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
// C. RESET PASSWORD (EMAIL FLOW)

const resetPassword = async (req, res) => {

    try {

        const { email, newPassword, confirmPassword } = req.body;
 
        if (!newPassword || newPassword !== confirmPassword) {

            return res.status(400).json({ success: false, message: "Passwords do not match or missing" });

        }
 
        const result = await findAccountByEmail(email);

        if (!result) {

            return res.status(404).json({ success: false, message: "User not found" });

        }
 
        const { account, Model } = result;
 
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await Model.findByIdAndUpdate(account._id, { $set: { password: hashedPassword } });

        await clearResetOTPFields(account._id, Model);
 
        res.json({

            success: true,

            message: "Password Reset Successfully. Please Login."

        });
 
    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
// =========================================================================

// 📱 MOBILE SMS FLOW (Firebase Auth Integration)

// =========================================================================
 
// A. Check if phone number exists in any of the 8 models

const forgotPasswordPhone = async (req, res) => {

    try {

        const { phone } = req.body;

        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });
 
        const result = await findAccountByPhone(phone);

        if (!result) {

            return res.status(404).json({ success: false, message: "No account registered with this phone number." });

        }
 
        res.json({ 

            success: true, 

            message: "Phone verified. Please trigger Firebase SMS OTP on the mobile client." 

        });

    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
// B. Verify Firebase idToken received from Mobile client SDK and return secure Reset Token

const verifyFirebaseOtp = async (req, res) => {

    try {

        const { phone, idToken } = req.body;
 
        if (!phone || !idToken) {

            return res.status(400).json({ success: false, message: "Phone number and Firebase idToken are required." });

        }
 
        let decodedToken;

        try {

            decodedToken = await admin.auth().verifyIdToken(idToken);

        } catch (authError) {

            console.error("Firebase ID Token verification error:", authError.message);

            return res.status(401).json({ success: false, message: "Invalid or expired Firebase ID token." });

        }
 
        const firebasePhone = decodedToken.phone_number; // e.g., "+919876543210"

        // Dynamic phone string comparison

        const cleanReqPhone = phone.replace(/\D/g, "");

        const cleanFirebasePhone = firebasePhone.replace(/\D/g, "");
 
        if (!cleanFirebasePhone.includes(cleanReqPhone)) {

            return res.status(400).json({ success: false, message: "Security Block: Phone number mismatch with Firebase token." });

        }
 
        const result = await findAccountByPhone(phone);

        if (!result) {

            return res.status(404).json({ success: false, message: "User profile not found." });

        }
 
        // Generate dynamic secure cryptographically safe reset token

        const secureResetToken = crypto.randomBytes(20).toString('hex');

        const expiryTime = Date.now() + 10 * 60 * 1000; // 10 mins
 
        await setResetOTPFields(result.account, result.Model, secureResetToken, expiryTime);
 
        res.json({

            success: true,

            message: "OTP Verified by Firebase successfully!",

            resetToken: secureResetToken // Passed to client for Step 3 reset validation

        });
 
    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
// C. Reset Password using the dynamic Reset Token

const resetPasswordPhone = async (req, res) => {

    try {

        const { phone, resetToken, newPassword, confirmPassword } = req.body;
 
        if (!newPassword || newPassword !== confirmPassword) {

            return res.status(400).json({ success: false, message: "Passwords do not match." });

        }
 
        const result = await findAccountByPhone(phone);

        if (!result) {

            return res.status(404).json({ success: false, message: "Account not found." });

        }
 
        const { account, Model } = result;
 
        // Check if token matches in database

        const savedToken = account.resetPasswordOtp || account.resetOTP;
 
        if (savedToken !== resetToken || account.resetPasswordExpires < Date.now()) {

            return res.status(400).json({ success: false, message: "Invalid or expired Reset Token." });

        }
 
        const hashedPassword = await bcrypt.hash(newPassword, 10);
 
        // Update password and clear temp OTP parameters

        await Model.findByIdAndUpdate(account._id, { $set: { password: hashedPassword } });

        await clearResetOTPFields(account._id, Model);
 
        res.json({

            success: true,

            message: "Password Reset Successfully. Please Login."

        });
 
    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
module.exports = { 

    forgotPassword, verifyOtp, resetPassword,

    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 

};
 