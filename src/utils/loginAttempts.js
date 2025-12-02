const pool = require('../../db');

/**
 * Track and check login attempts
 * Uses in-memory storage with automatic cleanup
 */

// Store login attempts: { username: { count: number, lastAttempt: Date, lockedUntil: Date } }
const loginAttempts = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [username, data] of loginAttempts.entries()) {
    // Remove entries older than 1 hour and not locked
    if (!data.lockedUntil && (now - data.lastAttempt) > 60 * 60 * 1000) {
      loginAttempts.delete(username);
    } else if (data.lockedUntil && now > data.lockedUntil) {
      // Unlock after lock period expires
      loginAttempts.delete(username);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get max login attempts from system settings
 */
async function getMaxLoginAttempts() {
  try {
    const result = await pool.query(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      ['max_login_attempts']
    );
    
    if (result.rows.length > 0 && result.rows[0].setting_value) {
      return parseInt(result.rows[0].setting_value) || 3;
    }
    return 3; // Default to 3 attempts
  } catch (error) {
    console.error('Error getting max login attempts:', error);
    return 3; // Default to 3 attempts
  }
}

/**
 * Record a failed login attempt
 */
async function recordFailedAttempt(username) {
  const maxAttempts = await getMaxLoginAttempts();
  const now = new Date();
  
  if (!loginAttempts.has(username)) {
    loginAttempts.set(username, {
      count: 1,
      lastAttempt: now,
      lockedUntil: null
    });
    return { attemptsRemaining: maxAttempts - 1, isLocked: false };
  }
  
  const data = loginAttempts.get(username);
  
  // Check if account is locked
  if (data.lockedUntil && now < data.lockedUntil) {
    return { attemptsRemaining: 0, isLocked: true, lockedUntil: data.lockedUntil };
  }
  
  // Reset if lock period expired
  if (data.lockedUntil && now >= data.lockedUntil) {
    loginAttempts.delete(username);
    loginAttempts.set(username, {
      count: 1,
      lastAttempt: now,
      lockedUntil: null
    });
    return { attemptsRemaining: maxAttempts - 1, isLocked: false };
  }
  
  // Increment failed attempts
  data.count += 1;
  data.lastAttempt = now;
  
  // Lock account if max attempts reached (lock for 30 minutes)
  if (data.count >= maxAttempts) {
    data.lockedUntil = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes
    loginAttempts.set(username, data);
    return { attemptsRemaining: 0, isLocked: true, lockedUntil: data.lockedUntil };
  }
  
  loginAttempts.set(username, data);
  return { attemptsRemaining: maxAttempts - data.count, isLocked: false };
}

/**
 * Check if username is locked due to failed attempts
 */
async function isLocked(username) {
  if (!loginAttempts.has(username)) {
    return { isLocked: false };
  }
  
  const data = loginAttempts.get(username);
  const now = new Date();
  
  if (data.lockedUntil && now < data.lockedUntil) {
    return { isLocked: true, lockedUntil: data.lockedUntil };
  }
  
  // Lock expired, clear it
  if (data.lockedUntil && now >= data.lockedUntil) {
    loginAttempts.delete(username);
    return { isLocked: false };
  }
  
  return { isLocked: false };
}

/**
 * Clear login attempts for a username (on successful login)
 */
function clearAttempts(username) {
  loginAttempts.delete(username);
}

module.exports = {
  recordFailedAttempt,
  isLocked,
  clearAttempts,
  getMaxLoginAttempts
};

