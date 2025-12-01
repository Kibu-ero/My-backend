const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db");
const { logAudit } = require("../../utils/auditLogger");
const axios = require("axios");
require("dotenv").config();

// ✅ Log when controller is loaded
console.log("✅ Auth Controller Loaded");

// **Register User (For Customers Only)**
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      email,
      password,
      street,
      barangay,
      city,
      province,
      birthdate,
      meterNumber,
      phoneNumber,
    } = req.body;

    // Basic required field validation
    if (!firstName || !lastName || !username || !password || !street || !barangay || !city || !province || !birthdate || !meterNumber || !phoneNumber) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ Check if username already exists in customer_accounts only
    const existingUsername = await pool.query(
      "SELECT * FROM customer_accounts WHERE username = $1",
      [username]
    );

    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ message: "Username is already in use." });
    }

    // ✅ Check if email already exists in customer_accounts only (if email provided)
    if (email && email.trim() !== '') {
      const existingUser = await pool.query(
        "SELECT * FROM customer_accounts WHERE email = $1",
        [email]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ message: "Email is already in use." });
      }
    }

    // ✅ Check if phone number already exists
    const existingPhone = await pool.query(
      "SELECT * FROM customer_accounts WHERE phone_number = $1",
      [phoneNumber]
    );

    if (existingPhone.rows.length > 0) {
      return res.status(400).json({ message: "Phone number is already in use." });
    }

    // ✅ Validate birthdate and calculate age
    const today = new Date();
    const birthDate = new Date(birthdate);
    
    if (birthDate > today) {
      return res.status(400).json({ message: "Birthdate cannot be in the future." });
    }
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    if (age < 18 || age > 120) {
      return res.status(400).json({ message: "You must be at least 18 years old to register." });
    }
    
    // Determine if user is a senior citizen (60+ years old)
    const isSeniorCitizen = age >= 60;

    // ✅ Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character."
      });
    }

    // ✅ Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Insert new customer into customer_accounts with Pending status
    const newUser = await pool.query(
      `INSERT INTO customer_accounts 
      (first_name, last_name, username, email, password, street, barangay, city, province, birthdate, meter_number, phone_number, senior_citizen, role, status, created_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'customer', 'Pending', NOW()) 
      RETURNING *`,
      [
        firstName,
        lastName,
        username,
        email || null, // Allow null email
        hashedPassword,
        street,
        barangay,
        city,
        province,
        birthdate,
        meterNumber,
        phoneNumber,
        isSeniorCitizen,
      ]
    );

    console.log("✅ New customer registered (Pending Approval):", newUser.rows[0].email);
    console.log("📱 Phone number stored in DB:", newUser.rows[0].phone_number);

    // Do NOT send OTP here. Just return a message.
    res.status(201).json({
      message: "Registration submitted! Please wait for admin approval.",
      user: newUser.rows[0],
      requiresOTP: false
    });
    
    // Log audit trail for new registration
    await logAudit({
      user_id: newUser.rows[0].id,
      bill_id: null,
      action: 'user_registered'
    });

  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message, code: error.code, detail: error.detail });
  }
};

// **Login User (For All Roles from Three Tables)**
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("Login attempt:", username);

    // Check login attempts tracking
    const { recordFailedAttempt, isLocked, clearAttempts } = require('../utils/loginAttempts');
    
    // Check if account is locked
    const lockStatus = await isLocked(username);
    if (lockStatus.isLocked) {
      const lockedUntil = new Date(lockStatus.lockedUntil);
      const minutesRemaining = Math.ceil((lockedUntil - new Date()) / (1000 * 60));
      return res.status(423).json({ 
        message: `Account locked due to too many failed login attempts. Please try again in ${minutesRemaining} minute(s).`,
        locked: true,
        lockedUntil: lockStatus.lockedUntil
      });
    }

    let user;
    // Try customer_accounts
    user = await pool.query(
      "SELECT id, username, email, password, 'customer' AS role, first_name, last_name, status FROM customer_accounts WHERE username = $1",
      [username]
    );
    console.log("Checked customer_accounts:", user.rows.length);

    if (user.rows.length === 0) {
      // Try users (admin/cashier)
      user = await pool.query(
        "SELECT id, username, email, password, role, name AS first_name, '' AS last_name FROM users WHERE username = $1",
        [username]
      );
      console.log("Checked users:", user.rows.length);
    }
    if (user.rows.length === 0) {
      // Try employees
      user = await pool.query(
        "SELECT id, username, email, password, role, first_name, last_name FROM employees WHERE username = $1",
        [username]
      );
      console.log("Checked employees:", user.rows.length);
    }
    if (user.rows.length === 0) {
      console.log("No user found for username:", username);
      // Record failed attempt for non-existent user too
      await recordFailedAttempt(username);
      return res.status(400).json({ message: "Invalid username or password." });
    }

    // Check if customer account is active (for customer accounts only)
    if (user.rows[0].role === 'customer' && user.rows[0].status === 'Pending') {
      return res.status(400).json({ 
        message: "Account not verified. Please check your phone for verification code or contact support." 
      });
    }

    if (user.rows[0].role === 'customer' && user.rows[0].status === 'Inactive') {
      return res.status(400).json({ 
        message: "Account is inactive. Please contact support for assistance." 
      });
    }

    // Validate password
    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    console.log("Password valid:", validPassword);

    if (!validPassword) {
      // Record failed login attempt
      const attemptInfo = await recordFailedAttempt(username);
      if (attemptInfo.isLocked) {
        const lockedUntil = new Date(attemptInfo.lockedUntil);
        const minutesRemaining = Math.ceil((lockedUntil - new Date()) / (1000 * 60));
        return res.status(423).json({ 
          message: `Account locked due to too many failed login attempts. Please try again in ${minutesRemaining} minute(s).`,
          locked: true,
          attemptsRemaining: 0
        });
      }
      return res.status(400).json({ 
        message: `Invalid username or password. ${attemptInfo.attemptsRemaining} attempt(s) remaining.`,
        attemptsRemaining: attemptInfo.attemptsRemaining
      });
    }

    // Clear login attempts on successful login
    clearAttempts(username);

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.rows[0].id, username: user.rows[0].username, email: user.rows[0].email, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    console.log("JWT generated");

    // Log audit trail for successful login
    await logAudit({
      user_id: user.rows[0].id,
      bill_id: null,
      action: 'login'
    });
    console.log("Audit logged");

    res.json({
      token,
      userId: user.rows[0].id,
      username: user.rows[0].username,
      email: user.rows[0].email,
      role: user.rows[0].role,
      firstName: user.rows[0].first_name,
      lastName: user.rows[0].last_name,
    });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.approveRegistration = async (req, res) => {
  try {
    const { userId } = req.body;
    console.log('[APPROVE REGISTRATION] Request received for userId:', userId);
    // Find the user
    const userResult = await pool.query('SELECT * FROM customer_accounts WHERE id = $1', [userId]);
    console.log('[APPROVE REGISTRATION] User lookup result:', userResult.rows);
    if (userResult.rows.length === 0) {
      console.log('[APPROVE REGISTRATION] User not found for id:', userId);
      return res.status(404).json({ message: 'User not found' });
    }
    const user = userResult.rows[0];
    console.log('[APPROVE REGISTRATION] User status:', user.status);
    if (user.status !== 'Pending') {
      console.log('[APPROVE REGISTRATION] User is not pending approval:', user.status);
      return res.status(400).json({ message: 'User is not pending approval' });
    }
    // Update status to Approved
    await pool.query('UPDATE customer_accounts SET status = $1 WHERE id = $2', ['Approved', userId]);
    // Generate and send OTP via Mocean Verify if configured, else fallback to Semaphore
    const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;
    const SEMAPHORE_SENDERNAME = process.env.SEMAPHORE_SENDERNAME || 'SEMAPHORE';
    const MOCEAN_API_TOKEN = process.env.MOCEAN_API_TOKEN;
    const MOCEAN_BRAND = process.env.MOCEAN_BRAND || 'Billink';

    const normalizeToPH63Format = (inputNumber) => {
      if (!inputNumber) return inputNumber;
      let digits = String(inputNumber).trim();
      digits = digits.replace(/[-\s]/g, '');
      if (digits.startsWith('+63')) return '63' + digits.slice(3);
      if (digits.startsWith('09')) return '63' + digits.slice(1);
      if (digits.startsWith('63')) return digits;
      if (digits.startsWith('9')) return '63' + digits;
      return digits;
    };

    const { otpStore } = require('../../routes/otp');
    const recipientNumber63 = normalizeToPH63Format(user.phone_number);

    if (MOCEAN_API_TOKEN) {
      try {
        // Validate number format for Mocean (63 + 10 digits)
        if (!/^63\d{10}$/.test(recipientNumber63)) {
          return res.status(400).json({ message: 'Invalid phone format. Use 63XXXXXXXXXX (PH).', otpSent: false });
        }
        const params = new URLSearchParams({ 'mocean-to': recipientNumber63, 'mocean-brand': MOCEAN_BRAND });
        const mres = await axios.post(
          'https://rest.moceanapi.com/rest/2/verify',
          params,
          { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } }
        );
        const data = mres.data || {};
        const reqId = data.reqid || data.request_id || data.mocean_reqid;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        otpStore.set(user.phone_number, { provider: 'mocean', reqId, expiresAt, purpose: 'registration', userId: user.id });
        console.log('[APPROVE REGISTRATION] OTP sent via Mocean Verify:', { status: data.status, reqId });
        return res.json({ message: 'User approved and OTP sent.', userId, otpSent: true, provider: 'mocean' });
      } catch (e) {
        const providerError = e?.response?.data;
        console.error('[APPROVE REGISTRATION] Mocean Verify failed:', providerError || e.message);
        // Fallback to Mocean SMS with locally generated OTP
        try {
          const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
          const otp = generateOTP();
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
          otpStore.set(user.phone_number, { otp, expiresAt, purpose: 'registration', userId: user.id });

          const smsBody = new URLSearchParams({
            'mocean-from': MOCEAN_BRAND,
            'mocean-to': recipientNumber63,
            'mocean-text': `Your Billink verification code is ${otp}. It expires in 5 minutes.`
          });
          await axios.post('https://rest.moceanapi.com/rest/2/sms', smsBody, {
            headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` }
          });
          console.log('[APPROVE REGISTRATION] OTP sent via Mocean SMS fallback');
          return res.json({ message: 'User approved and OTP sent.', userId, otpSent: true, provider: 'mocean_sms' });
        } catch (smsErr) {
          console.error('[APPROVE REGISTRATION] Mocean SMS fallback failed:', smsErr?.response?.data || smsErr.message);
          return res.status(502).json({ message: 'User approved, but failed to send OTP via Mocean.', otpSent: false, provider: 'mocean', details: providerError || e.message });
        }
      }
    }
    // No Mocean configured
    console.log('[APPROVE REGISTRATION] No MOCEAN_API_TOKEN configured. Cannot send OTP.');
    return res.status(500).json({ message: 'OTP provider not configured. Set MOCEAN_API_TOKEN.', userId, otpSent: false });
  } catch (error) {
    console.error('[APPROVE REGISTRATION] Error in approveRegistration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
