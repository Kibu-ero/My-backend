const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logAudit } = require('../utils/auditLogger');

// Get all settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings ORDER BY setting_key');
    
    // Convert rows to key-value object
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

// Update settings
router.put('/', async (req, res) => {
  try {
    const { user } = req; // Assuming user is attached by auth middleware
    const userId = user?.id || 'system';
    
    const settings = req.body;
    const updates = [];
    
    // Process each setting
    for (const [key, value] of Object.entries(settings)) {
      // Validate setting key
      const validKeys = [
        'system_name', 'company_name', 'contact_email', 'water_rate', 
        'late_payment_fee', 'due_date_grace_period', 'senior_citizen_discount',
        'email_notifications', 'maintenance_mode', 'backup_frequency', 
        'max_login_attempts', 'session_timeout'
      ];
      
      if (!validKeys.includes(key)) {
        continue; // Skip invalid keys
      }
      
      // Convert value to string for storage
      const stringValue = typeof value === 'boolean' ? value.toString() : String(value);
      
      updates.push(
        pool.query(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_by = $3, updated_at = NOW()',
          [key, stringValue, userId]
        )
      );
    }
    
    await Promise.all(updates);
    
    // Log the settings update
    try {
      await logAudit({
        user_id: userId,
        action: 'SETTINGS_UPDATE',
        entity: 'system_settings',
        entity_id: null,
        details: { updatedSettings: Object.keys(settings) },
        ip_address: req.ip
      });
    } catch (auditError) {
      console.warn('Failed to log audit:', auditError);
    }
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: 'Failed to update settings' });
  }
});

// Get water rates specifically
router.get('/water-rates', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        consumption_min, 
        consumption_max, 
        rate_per_cubic_meter, 
        fixed_amount,
        is_active
      FROM water_rates 
      WHERE is_active = true 
      ORDER BY consumption_min
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching water rates:', error);
    res.status(500).json({ message: 'Failed to fetch water rates' });
  }
});

// Update water rates
router.put('/water-rates', async (req, res) => {
  try {
    const { user } = req;
    const userId = user?.id || 'system';
    const { rates } = req.body;
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Deactivate all existing rates
      await pool.query('UPDATE water_rates SET is_active = false, updated_by = $1, updated_at = NOW()', [userId]);
      
      // Insert new rates
      for (const rate of rates) {
        await pool.query(`
          INSERT INTO water_rates (consumption_min, consumption_max, rate_per_cubic_meter, fixed_amount, is_active, created_by, updated_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, true, $5, $5, NOW(), NOW())
        `, [
          rate.consumption_min,
          rate.consumption_max,
          rate.rate_per_cubic_meter || null,
          rate.fixed_amount || null,
          userId
        ]);
      }
      
      await pool.query('COMMIT');
      
      // Log the water rates update
      try {
        await logAudit({
          user_id: userId,
          action: 'WATER_RATES_UPDATE',
          entity: 'water_rates',
          entity_id: null,
          details: { ratesCount: rates.length },
          ip_address: req.ip
        });
      } catch (auditError) {
        console.warn('Failed to log audit:', auditError);
      }
      
      res.json({ message: 'Water rates updated successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating water rates:', error);
    res.status(500).json({ message: 'Failed to update water rates' });
  }
});

// Get payment settings
router.get('/payment', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT setting_key, setting_value 
      FROM system_settings 
      WHERE setting_key IN ('late_payment_fee', 'due_date_grace_period', 'senior_citizen_discount')
    `);
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching payment settings:', error);
    res.status(500).json({ message: 'Failed to fetch payment settings' });
  }
});

// Update payment settings
router.put('/payment', async (req, res) => {
  try {
    const { user } = req;
    const userId = user?.id || 'system';
    const settings = req.body;
    
    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
      updates.push(
        pool.query(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_by = $3, updated_at = NOW()',
          [key, String(value), userId]
        )
      );
    }
    
    await Promise.all(updates);
    
    try {
      await logAudit({
        user_id: userId,
        action: 'PAYMENT_SETTINGS_UPDATE',
        entity: 'system_settings',
        entity_id: null,
        details: { updatedSettings: Object.keys(settings) },
        ip_address: req.ip
      });
    } catch (auditError) {
      console.warn('Failed to log audit:', auditError);
    }
    
    res.json({ message: 'Payment settings updated successfully' });
  } catch (error) {
    console.error('Error updating payment settings:', error);
    res.status(500).json({ message: 'Failed to update payment settings' });
  }
});

module.exports = router;

