const pool = require('../db');

/**
 * Middleware to check if maintenance mode is enabled
 * Allows access to:
 * - /api/settings (so admins can turn off maintenance mode)
 * - /health (health checks)
 * - Login endpoint (so admins can log in to turn off maintenance)
 */
async function checkMaintenanceMode(req, res, next) {
  try {
    // Allow health checks
    if (req.path === '/health' || req.path === '/api/health') {
      return next();
    }
    
    // Allow access to settings endpoint (so admins can disable maintenance)
    if (req.path.startsWith('/api/settings')) {
      return next();
    }
    
    // Allow login attempts (so admins can log in)
    if (req.path === '/api/auth/login' && req.method === 'POST') {
      return next();
    }
    
    // Check maintenance mode setting
    const result = await pool.query(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      ['maintenance_mode']
    );
    
    const maintenanceMode = result.rows.length > 0 
      ? result.rows[0].setting_value === 'true'
      : false;
    
    if (maintenanceMode) {
      // Check if user is admin (for system settings access)
      if (req.user && (req.user.role === 'admin' || req.user.role === 'Administrator')) {
        // Allow admin access to turn off maintenance
        return next();
      }
      
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'The system is currently under maintenance. Please try again later.',
        maintenance: true
      });
    }
    
    next();
  } catch (error) {
    console.error('Error checking maintenance mode:', error);
    // On error, allow request to proceed (fail open)
    next();
  }
}

module.exports = checkMaintenanceMode;

