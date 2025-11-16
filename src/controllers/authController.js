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
    // Check database connection
    if (!pool) {
      console.error("❌ Database pool not available");
      return res.status(500).json({ 
        message: "Database connection not available",
        error: "Database pool is undefined"
      });
    }

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

    // Log incoming request for debugging
    console.log("📝 Registration attempt:", {
      username,
      email: email ? "provided" : "not provided",
      phoneNumber: phoneNumber ? "provided" : "not provided",
      meterNumber: meterNumber ? "provided" : "not provided"
    });

    // Basic required field validation (email is optional)
    if (!firstName || !lastName || !username || !password || !street || !barangay || !city || !province || !birthdate || !meterNumber || !phoneNumber) {
      return res.status(400).json({ 
        message: "Missing required fields",
        missing: {
          firstName: !firstName,
          lastName: !lastName,
          username: !username,
          password: !password,
          street: !street,
          barangay: !barangay,
          city: !city,
          province: !province,
          birthdate: !birthdate,
          meterNumber: !meterNumber,
          phoneNumber: !phoneNumber
        }
      });
    }

    // Validate email format if provided
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ message: "Please provide a valid email address." });
      }
    }

    // ✅ Check if username already exists in customer_accounts only
    try {
      const existingUsername = await pool.query(
        "SELECT * FROM customer_accounts WHERE username = $1",
        [username]
      );

      if (existingUsername.rows.length > 0) {
        return res.status(400).json({ message: "Username is already in use." });
      }
    } catch (dbError) {
      console.error("❌ Database error checking username:", dbError);
      throw dbError; // Re-throw to be caught by outer catch
    }

    // ✅ Check if email already exists in customer_accounts only (if email provided)
    if (email && email.trim() !== '') {
      try {
        const existingUser = await pool.query(
          "SELECT * FROM customer_accounts WHERE email = $1",
          [email.trim()]
        );

        if (existingUser.rows.length > 0) {
          return res.status(400).json({ message: "Email is already in use." });
        }
      } catch (dbError) {
        console.error("❌ Database error checking email:", dbError);
        throw dbError; // Re-throw to be caught by outer catch
      }
    }

    // ✅ Check if phone number already exists
    try {
      const existingPhone = await pool.query(
        "SELECT * FROM customer_accounts WHERE phone_number = $1",
        [phoneNumber]
      );

      if (existingPhone.rows.length > 0) {
        return res.status(400).json({ message: "Phone number is already in use." });
      }
    } catch (dbError) {
      console.error("❌ Database error checking phone number:", dbError);
      throw dbError; // Re-throw to be caught by outer catch
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

    // ✅ Normalize email (empty string to null)
    const normalizedEmail = (email && email.trim() !== '') ? email.trim() : null;

    // ✅ Insert new customer into customer_accounts with Pending status
    let newUser;
    try {
      newUser = await pool.query(
        `INSERT INTO customer_accounts 
        (first_name, last_name, username, email, password, street, barangay, city, province, birthdate, meter_number, phone_number, senior_citizen, role, status, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'customer', 'Pending', NOW()) 
        RETURNING *`,
        [
          firstName?.trim() || firstName,
          lastName?.trim() || lastName,
          username?.trim() || username,
          normalizedEmail,
          hashedPassword,
          street?.trim() || street,
          barangay?.trim() || barangay,
          city?.trim() || city,
          province?.trim() || province,
          birthdate,
          meterNumber?.trim() || meterNumber,
          phoneNumber?.trim() || phoneNumber,
          isSeniorCitizen,
        ]
      );
    } catch (insertError) {
      console.error("❌ Database insert error:", insertError);
      // Check for specific constraint violations
      if (insertError.code === '23505') { // Unique violation
        const constraint = insertError.constraint;
        if (constraint && constraint.includes('username')) {
          return res.status(400).json({ message: "Username is already in use." });
        }
        if (constraint && constraint.includes('email')) {
          return res.status(400).json({ message: "Email is already in use." });
        }
        if (constraint && constraint.includes('phone_number')) {
          return res.status(400).json({ message: "Phone number is already in use." });
        }
        if (constraint && constraint.includes('meter_number')) {
          return res.status(400).json({ message: "Meter number is already in use." });
        }
        return res.status(400).json({ message: "A record with this information already exists." });
      }
      throw insertError; // Re-throw to be caught by outer catch
    }

    console.log("✅ New customer registered (Pending Approval):", newUser.rows[0].email);
    console.log("📱 Phone number stored in DB:", newUser.rows[0].phone_number);

    // Log audit trail for new registration (before sending response)
    try {
      await logAudit({
        user_id: newUser.rows[0].id,
        action: 'user_registered',
        entity: 'customer_accounts',
        entity_id: newUser.rows[0].id
      });
    } catch (auditError) {
      // Log audit error but don't fail registration
      console.error("⚠️ Audit log failed (non-critical):", auditError.message);
    }

    // Do NOT send OTP here. Just return a message.
    res.status(201).json({
      message: "Registration submitted! Please wait for admin approval.",
      user: newUser.rows[0],
      requiresOTP: false
    });

  } catch (error) {
    console.error("❌ Registration Error:", error);
    console.error("❌ Registration Error Stack:", error.stack);
    console.error("❌ Registration Error Details:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
      name: error.name,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      port: error.port
    });
    
    // Determine if this is a database connection error
    const isDbError = error.code === 'ECONNREFUSED' || 
                     error.code === 'ENOTFOUND' || 
                     error.code === 'ETIMEDOUT' ||
                     error.message?.includes('connect') ||
                     error.message?.includes('Connection');

    res.status(500).json({ 
      message: isDbError ? "Database connection error" : "Internal Server Error", 
      error: error.message, 
      code: error.code, 
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
      name: error.name,
      // Include stack trace in development
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// **Login User (For All Roles from Three Tables)**
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required." });
    }
    
    console.log("🔐 Login attempt for username:", username);

    let user;
    // Try customer_accounts
    try {
      user = await pool.query(
        "SELECT id, username, email, password, 'customer' AS role, first_name, last_name, status FROM customer_accounts WHERE username = $1",
        [username]
      );
      console.log("✅ Checked customer_accounts:", user.rows.length);
    } catch (dbError) {
      console.error("❌ Database error checking customer_accounts:", dbError.message);
      throw dbError;
    }

    if (user.rows.length === 0) {
      // Try users (admin/cashier)
      try {
        user = await pool.query(
          "SELECT id, username, email, password, role, name AS first_name, '' AS last_name FROM users WHERE username = $1",
          [username]
        );
        console.log("✅ Checked users table:", user.rows.length);
      } catch (dbError) {
        console.error("❌ Database error checking users:", dbError.message);
        throw dbError;
      }
    }
    if (user.rows.length === 0) {
      // Try employees
      try {
        user = await pool.query(
          "SELECT id, username, email, password, role, first_name, last_name FROM employees WHERE username = $1",
          [username]
        );
        console.log("✅ Checked employees table:", user.rows.length);
      } catch (dbError) {
        console.error("❌ Database error checking employees:", dbError.message);
        throw dbError;
      }
    }
    if (user.rows.length === 0) {
      console.log("No user found for username:", username);
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
    if (!user.rows[0].password) {
      console.error("❌ User has no password set");
      return res.status(400).json({ message: "Invalid username or password." });
    }
    
    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    console.log("✅ Password validation result:", validPassword);

    if (!validPassword) {
      return res.status(400).json({ message: "Invalid username or password." });
    }

    // Generate JWT Token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("❌ JWT_SECRET is not set in environment variables");
      return res.status(500).json({ message: "Server configuration error. Please contact support." });
    }
    
    const token = jwt.sign(
      { id: user.rows[0].id, username: user.rows[0].username, email: user.rows[0].email, role: user.rows[0].role },
      jwtSecret,
      { expiresIn: "1d" }
    );
    console.log("✅ JWT generated successfully");

    // Log audit trail for successful login
    try {
      await logAudit({
        user_id: user.rows[0].id,
        bill_id: null,
        action: 'login',
        entity: 'system',
        entity_id: null,
        details: { 
          username: user.rows[0].username, 
          role: user.rows[0].role,
          email: user.rows[0].email || null
        },
        ip_address: req.ip || req.connection?.remoteAddress || null
      });
      console.log(`✅ Audit logged for login: User ${user.rows[0].id} (${user.rows[0].username})`);
    } catch (auditError) {
      // Log audit error but don't fail login
      console.error("⚠️ Audit log failed (non-critical):", auditError.message);
      console.error("⚠️ Audit log error stack:", auditError.stack);
    }

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
    console.error("❌ Login Error Stack:", error.stack);
    console.error("❌ Login Error Details:", {
      message: error.message,
      code: error.code,
      name: error.name
    });
    res.status(500).json({ 
      message: "Internal Server Error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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

    // Environment
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

    // FORCE SMS: Always send local OTP via Mocean SMS when token available (skip Verify)
    if (MOCEAN_API_TOKEN) {
      try {
        // Validate number format for Mocean (63 + 10 digits)
        if (!/^63\d{10}$/.test(recipientNumber63)) {
          return res.status(400).json({ message: 'Invalid phone format. Use 63XXXXXXXXXX (PH).', otpSent: false });
        }
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
        console.log('[APPROVE REGISTRATION] OTP sent via Mocean SMS (forced)');
        return res.json({ message: 'User approved and OTP sent.', userId, otpSent: true, provider: 'mocean_sms' });
      } catch (e) {
        console.error('[APPROVE REGISTRATION] Forced Mocean SMS failed:', e?.response?.data || e.message);
        return res.status(502).json({ message: 'User approved, but failed to send OTP via Mocean SMS.', otpSent: false, provider: 'mocean_sms', details: e?.response?.data || e.message });
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

// Reset password using short-lived resetToken from /api/otp/verify-reset
exports.resetPasswordWithToken = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: 'resetToken and newPassword are required' });
    }

    // Validate password strength (reuse same regex)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character.' });
    }

    // Verify reset token and extract phoneNumber from it
    let payload;
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: 'Invalid or expired reset token' });
    }
    
    // Verify token purpose and extract phoneNumber from token (token is source of truth)
    if (payload.purpose !== 'reset' || !payload.phoneNumber) {
      return res.status(401).json({ message: 'Invalid reset token' });
    }
    
    const phoneNumber = payload.phoneNumber; // Get phoneNumber from token, not request body

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password in customer_accounts using phoneNumber from token
    const result = await pool.query(
      'UPDATE customer_accounts SET password = $1, updated_at = NOW() WHERE phone_number = $2 RETURNING id, username, email, role',
      [hashedPassword, phoneNumber]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found with this phone number' });
    }

    // Optionally invalidate sessions; for now, instruct user to log in
    return res.json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};
