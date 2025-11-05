const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../db');

// Semaphore configuration
const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;
const SEMAPHORE_SENDERNAME = process.env.SEMAPHORE_SENDERNAME || 'SEMAPHORE';

// Mocean configuration
const MOCEAN_API_TOKEN = process.env.MOCEAN_API_TOKEN;
const MOCEAN_BRAND = process.env.MOCEAN_BRAND || 'Billink';

// Store OTP codes temporarily (in production, use Redis or database)
const otpStore = new Map();

// Export otpStore for use in other modules
module.exports = { router, otpStore };

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Normalize PH numbers to 63 format (no plus)
const normalizeToPH63Format = (inputNumber) => {
  if (!inputNumber) return inputNumber;

  let digits = String(inputNumber).trim();

  // Remove spaces and hyphens
  digits = digits.replace(/[-\s]/g, '');

  // If starts with +63, convert to 63
  if (digits.startsWith('+63')) {
    return '63' + digits.slice(3);
  }

  // If starts with 09, convert to 63
  if (digits.startsWith('09')) {
    return '63' + digits.slice(1);
  }

  // If already starts with 63, keep as is
  if (digits.startsWith('63')) {
    return digits;
  }

  // Fallback: if starts with 9 and length 10/11, assume local and add 63
  if (digits.startsWith('9')) {
    return '63' + digits;
  }

  return digits;
};

// Ensure number is valid 63XXXXXXXXXX (11-13 digits with 63 prefix)
const validatePH63Number = (digits) => {
  if (!digits) return false;
  const d = String(digits).trim();
  return /^63\d{10}$/.test(d);
};

// Send OTP via SMS (Mocean Verify preferred if configured)
router.post('/send', async (req, res) => {
  try {
    const { phoneNumber, purpose = 'login', userId } = req.body;
    
    console.log('🔔 OTP Send Request:', { phoneNumber, purpose, userId });
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Normalize phone number to 63 format (required by Semaphore)
    const recipientNumber63 = normalizeToPH63Format(phoneNumber);
    console.log('📱 Normalized Phone (63 format):', recipientNumber63);

    // Prefer Mocean Verify if configured
    if (MOCEAN_API_TOKEN) {
      if (!validatePH63Number(recipientNumber63)) {
        return res.status(400).json({ error: 'Invalid phone format. Use 63XXXXXXXXXX (PH).'});
      }
      const params = new URLSearchParams({
        'mocean-to': recipientNumber63,
        'mocean-brand': MOCEAN_BRAND
      });
      const mres = await axios.post(
        'https://rest.moceanapi.com/rest/2/verify',
        params,
        { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } }
      );
      const data = mres.data || {};
      const reqId = data.reqid || data.request_id || data.mocean_reqid;

      // Store request with expiration
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      otpStore.set(phoneNumber, { provider: 'mocean', reqId, expiresAt, purpose, userId });

      console.log('✅ OTP sent via Mocean Verify:', { phoneNumber, reqId, status: data.status });
      return res.json({ message: 'OTP sent successfully', provider: 'mocean', reqId, status: data.status });
    }

    // Fallback to Semaphore OTP if Mocean not configured
    const otp = generateOTP();
    console.log('🔢 Generated OTP:', otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    otpStore.set(phoneNumber, { otp, expiresAt, purpose, userId });

    if (!SEMAPHORE_API_KEY) {
      console.error('❌ No OTP provider configured');
      return res.status(500).json({ error: 'SMS service not configured' });
    }
    const params = new URLSearchParams({
      apikey: SEMAPHORE_API_KEY,
      number: recipientNumber63,
      message: 'Your Billink verification code is: {otp}. Valid for 5 minutes.',
      sendername: SEMAPHORE_SENDERNAME,
      code: otp
    });
    const semaphoreResponse = await axios.post('https://semaphore.co/api/v4/otp', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const responseData = Array.isArray(semaphoreResponse.data) ? semaphoreResponse.data[0] : semaphoreResponse.data;
    console.log('✅ OTP sent via Semaphore:', { phoneNumber, messageId: responseData?.message_id, recipient: responseData?.recipient, status: responseData?.status });
    res.json({ message: 'OTP sent successfully', provider: 'semaphore', messageId: responseData?.message_id, status: responseData?.status, recipient: responseData?.recipient });

  } catch (error) {
    // Attempt to extract provider error details
    const providerError = error?.response?.data;
    const rateLimitInfo = {
      limit: error?.response?.headers?.['x-ratelimit-limit'],
      remaining: error?.response?.headers?.['x-ratelimit-remaining'],
      retryAfter: error?.response?.headers?.['retry-after']
    };
    console.error('❌ Error sending OTP via Semaphore:', { message: error.message, providerError, rateLimitInfo });
    res.status(500).json({ error: 'Failed to send OTP', details: providerError, rateLimit: rateLimitInfo });
  }
});

// Start password reset: send OTP with purpose "reset"
router.post('/start-reset', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });
    // Reuse send with purpose=reset by calling local handler
    req.body.purpose = 'reset';
    // Fallthrough to /send logic by calling it explicitly is messy; instead, duplicate minimal steps
    const recipientNumber63 = normalizeToPH63Format(phoneNumber);
    if (MOCEAN_API_TOKEN) {
      if (!validatePH63Number(recipientNumber63)) {
        return res.status(400).json({ error: 'Invalid phone format. Use 63XXXXXXXXXX (PH).'});
      }
      const params = new URLSearchParams({ 'mocean-to': recipientNumber63, 'mocean-brand': MOCEAN_BRAND });
      const mres = await axios.post('https://rest.moceanapi.com/rest/2/verify', params, { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } });
      const data = mres.data || {};
      const reqId = data.reqid || data.request_id || data.mocean_reqid;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      otpStore.set(phoneNumber, { provider: 'mocean', reqId, expiresAt, purpose: 'reset' });
      return res.json({ message: 'OTP sent', provider: 'mocean', reqId, status: data.status });
    }
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    otpStore.set(phoneNumber, { otp, expiresAt, purpose: 'reset' });
    if (!SEMAPHORE_API_KEY) return res.status(500).json({ error: 'SMS service not configured' });
    const params = new URLSearchParams({ apikey: SEMAPHORE_API_KEY, number: recipientNumber63, message: 'Your Billink reset code is: {otp}. Valid for 5 minutes.', sendername: SEMAPHORE_SENDERNAME, code: otp });
    const semaphoreResponse = await axios.post('https://semaphore.co/api/v4/otp', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const responseData = Array.isArray(semaphoreResponse.data) ? semaphoreResponse.data[0] : semaphoreResponse.data;
    res.json({ message: 'OTP sent', provider: 'semaphore', messageId: responseData?.message_id, status: responseData?.status, recipient: responseData?.recipient });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start password reset', details: error?.response?.data || error.message });
  }
});

// Verify reset OTP and return a short-lived reset token
router.post('/verify-reset', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    if (!phoneNumber || !otp) return res.status(400).json({ error: 'Phone number and OTP are required' });
    const stored = otpStore.get(phoneNumber);
    if (!stored || stored.purpose !== 'reset') return res.status(400).json({ error: 'OTP not found or expired' });
    if (new Date() > stored.expiresAt) { otpStore.delete(phoneNumber); return res.status(400).json({ error: 'OTP has expired' }); }
    if (stored.provider === 'mocean') {
      const params = new URLSearchParams({ 'mocean-reqid': stored.reqId, 'mocean-code': otp });
      try {
        const vres = await axios.post('https://rest.moceanapi.com/rest/2/verify/check', params, { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } });
        const data = vres.data || {};
        if (String(data.status) !== '0') return res.status(400).json({ error: 'Invalid OTP', providerStatus: data.status, detail: data.err_msg });
      } catch (e) { return res.status(400).json({ error: 'Invalid OTP', details: e?.response?.data || e.message }); }
    } else {
      if (stored.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    }
    // issue short-lived reset token
    const jwt = require('jsonwebtoken');
    const resetToken = jwt.sign({ phoneNumber, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    // clear OTP
    otpStore.delete(phoneNumber);
    res.json({ message: 'OTP verified', resetToken });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify reset OTP' });
  }
});

// Verify OTP
router.post('/verify', async (req, res) => {
  try {
    const { phoneNumber, otp, purpose = 'login' } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }

    // Get stored OTP/request data
    const storedData = otpStore.get(phoneNumber);
    
    console.log('[OTP VERIFICATION] Phone number:', phoneNumber);
    console.log('[OTP VERIFICATION] Submitted OTP:', otp);
    console.log('[OTP VERIFICATION] Stored data:', storedData);
    console.log('[OTP VERIFICATION] All stored OTPs:', Array.from(otpStore.entries()));
    
    if (!storedData) {
      return res.status(400).json({ error: 'OTP not found or expired' });
    }

    // Check if expired
    if (new Date() > storedData.expiresAt) {
      otpStore.delete(phoneNumber);
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // If Mocean provider, verify via Mocean API
    if (storedData.provider === 'mocean') {
      const params = new URLSearchParams({
        'mocean-reqid': storedData.reqId,
        'mocean-code': otp
      });
      try {
        const vres = await axios.post(
          'https://rest.moceanapi.com/rest/2/verify/check',
          params,
          { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } }
        );
        const data = vres.data || {};
        // Mocean returns status 0 on success
        if (String(data.status) !== '0') {
          return res.status(400).json({ error: 'Invalid OTP', providerStatus: data.status, detail: data.err_msg });
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid OTP', details: e?.response?.data || e.message });
      }
    } else {
      // Local OTP check (Semaphore flow)
      console.log('[OTP VERIFICATION] Comparing OTPs - Submitted:', otp, 'Stored:', storedData.otp);
      if (storedData.otp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
    }

    // Check if purpose matches
    if (storedData.purpose !== purpose) {
      return res.status(400).json({ error: 'OTP purpose mismatch' });
    }

    // Remove OTP from store after successful verification
    otpStore.delete(phoneNumber);

    // If this is for login, find user and return JWT token
    if (purpose === 'login') {
      const userQuery = await pool.query(
        'SELECT id, username, email, role, first_name, last_name FROM customer_accounts WHERE phone_number = $1',
        [phoneNumber]
      );

      if (userQuery.rows.length === 0) {
        return res.status(404).json({ error: 'User not found with this phone number' });
      }

      const user = userQuery.rows[0];
      
      // Generate JWT token
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { 
          id: user.id, 
          username: user.username,
          email: user.email, 
          role: user.role 
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        message: 'OTP verified successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name
        }
      });
    } else {
      res.json({ message: 'OTP verified successfully' });
    }

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Verify OTP for registration
router.post('/verify-registration', async (req, res) => {
  try {
    console.log('\n🔍 [OTP VERIFICATION] Starting verification process...');
    const { phoneNumber, otp } = req.body;
    
    console.log('📱 [OTP VERIFICATION] Request body:', { phoneNumber, otp });
    
    if (!phoneNumber || !otp) {
      console.log('❌ [OTP VERIFICATION] Missing phone number or OTP');
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }

    // Get stored OTP data
    const storedData = otpStore.get(phoneNumber);
    
    console.log('🔍 [OTP VERIFICATION] Phone number:', phoneNumber);
    console.log('🔍 [OTP VERIFICATION] Submitted OTP:', otp);
    console.log('🔍 [OTP VERIFICATION] Stored data:', storedData);
    console.log('🔍 [OTP VERIFICATION] All stored OTPs:', Array.from(otpStore.entries()));
    
    if (!storedData) {
      console.log('❌ [OTP VERIFICATION] No stored data found for phone number');
      return res.status(400).json({ error: 'OTP not found or expired' });
    }

    // Check if OTP is expired
    console.log('⏰ [OTP VERIFICATION] Checking OTP expiration...');
    console.log('⏰ [OTP VERIFICATION] Current time:', new Date());
    console.log('⏰ [OTP VERIFICATION] OTP expires at:', storedData.expiresAt);
    
    if (new Date() > storedData.expiresAt) {
      console.log('❌ [OTP VERIFICATION] OTP has expired');
      otpStore.delete(phoneNumber);
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check if OTP matches
    console.log('🔢 [OTP VERIFICATION] Comparing OTPs - Submitted:', otp, 'Stored:', storedData.otp);
    if (storedData.otp !== otp) {
      console.log('❌ [OTP VERIFICATION] OTP mismatch');
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Check if purpose is registration
    console.log('🎯 [OTP VERIFICATION] Checking OTP purpose:', storedData.purpose);
    if (storedData.purpose !== 'registration') {
      console.log('❌ [OTP VERIFICATION] Wrong OTP purpose');
      return res.status(400).json({ error: 'OTP purpose mismatch' });
    }

    console.log('✅ [OTP VERIFICATION] OTP validation passed!');
    console.log('👤 [OTP VERIFICATION] User ID from stored data:', storedData.userId);

    // Update user status from 'Approved' to 'Active'
    console.log('🔄 [OTP VERIFICATION] Attempting to update user:', storedData.userId);
    console.log('🔄 [OTP VERIFICATION] Looking for user with status: Approved');
    
    // First, let's check the current user status
    const userStatusCheck = await pool.query('SELECT id, status FROM customer_accounts WHERE id = $1', [storedData.userId]);
    console.log('👤 [OTP VERIFICATION] Current user status:', userStatusCheck.rows[0]);
    
    const updateResult = await pool.query(
      'UPDATE customer_accounts SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
      ['Active', storedData.userId, 'Approved']
    );

    console.log('🔄 [OTP VERIFICATION] Update result rows:', updateResult.rows.length);
    
    if (updateResult.rows.length === 0) {
      // Let's check what the actual user status is
      const userCheck = await pool.query('SELECT id, status FROM customer_accounts WHERE id = $1', [storedData.userId]);
      console.log('❌ [OTP VERIFICATION] User check result:', userCheck.rows);
      console.log('❌ [OTP VERIFICATION] Update failed - no rows affected');
      return res.status(400).json({ error: 'User not found or already verified' });
    }

    console.log('✅ [OTP VERIFICATION] User status updated successfully!');

    // Remove OTP from store after successful verification
    otpStore.delete(phoneNumber);
    console.log('🗑️ [OTP VERIFICATION] OTP removed from store');

    // Generate JWT token for immediate login
    const jwt = require('jsonwebtoken');
    const user = updateResult.rows[0];
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username,
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('🎉 [OTP VERIFICATION] Verification completed successfully!');
    console.log('🎉 [OTP VERIFICATION] User email:', user.email);

    res.json({
      message: 'Account verified successfully! You can now login.',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        status: user.status
      }
    });

  } catch (error) {
    console.error('💥 [OTP VERIFICATION] Error:', error);
    res.status(500).json({ error: 'Failed to verify registration OTP' });
  }
});

// Resend OTP
router.post('/resend', async (req, res) => {
  try {
    const { phoneNumber, purpose = 'login' } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Remove existing OTP if any
    otpStore.delete(phoneNumber);

    // Prefer Mocean Verify resend if configured and we have a reqId
    const existing = otpStore.get(phoneNumber);
    if (MOCEAN_API_TOKEN && existing && existing.provider === 'mocean' && existing.reqId) {
      try {
        const params = new URLSearchParams({ 'mocean-reqid': existing.reqId });
        // Mocean Verify resend endpoint
        const rres = await axios.post(
          'https://rest.moceanapi.com/rest/2/verify/resend',
          params,
          { headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` } }
        );
        const data = rres.data || {};
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        otpStore.set(phoneNumber, { ...existing, expiresAt });
        console.log('✅ OTP resent via Mocean Verify:', { phoneNumber, reqId: existing.reqId, status: data.status });
        return res.json({ message: 'OTP resent successfully', provider: 'mocean', reqId: existing.reqId, status: data.status });
      } catch (e) {
        console.error('❌ Error resending via Mocean:', e?.response?.data || e.message);
        // fall through to send new
      }
    }

    // Fallback: generate new local OTP and send via Semaphore
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    otpStore.set(phoneNumber, { otp, expiresAt, purpose });

    const recipientNumber63 = normalizeToPH63Format(phoneNumber);
    if (!SEMAPHORE_API_KEY) {
      console.error('❌ No OTP provider configured for resend');
      return res.status(500).json({ error: 'SMS service not configured' });
    }
    const params = new URLSearchParams({
      apikey: SEMAPHORE_API_KEY,
      number: recipientNumber63,
      message: 'Your new Billink verification code is: {otp}. Valid for 5 minutes.',
      sendername: SEMAPHORE_SENDERNAME,
      code: otp
    });
    const semaphoreResponse = await axios.post('https://semaphore.co/api/v4/otp', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const responseData = Array.isArray(semaphoreResponse.data) ? semaphoreResponse.data[0] : semaphoreResponse.data;
    console.log('✅ OTP resent via Semaphore:', { phoneNumber, messageId: responseData?.message_id, status: responseData?.status });
    res.json({ message: 'OTP resent successfully', provider: 'semaphore', messageId: responseData?.message_id, status: responseData?.status, recipient: responseData?.recipient });

  } catch (error) {
    const providerError = error?.response?.data;
    const rateLimitInfo = {
      limit: error?.response?.headers?.['x-ratelimit-limit'],
      remaining: error?.response?.headers?.['x-ratelimit-remaining'],
      retryAfter: error?.response?.headers?.['retry-after']
    };
    console.error('Error resending OTP via Semaphore:', { message: error.message, providerError, rateLimitInfo });
    res.status(500).json({ error: 'Failed to resend OTP', details: providerError, rateLimit: rateLimitInfo });
  }
}); 

// Fetch OTP/SMS delivery status by message id
router.get('/status/:id', async (req, res) => {
  try {
    if (!SEMAPHORE_API_KEY) {
      return res.status(500).json({ error: 'SMS service not configured' });
    }
    const { id } = req.params;
    const response = await axios.get(`https://semaphore.co/api/v4/messages/${encodeURIComponent(id)}`, {
      params: { apikey: SEMAPHORE_API_KEY }
    });
    res.json(response.data);
  } catch (error) {
    const providerError = error?.response?.data;
    console.error('❌ Error fetching message status:', { message: error.message, providerError });
    res.status(500).json({ error: 'Failed to fetch message status', details: providerError });
  }
});
