const express = require('express');
const pool = require('../db');
const router = express.Router();

// Get audit logs (optionally filter by user, action, date, bill)
router.get('/', async (req, res) => {
  console.log("GET /api/audit-logs hit");
  const { user_id, name, action, bill_id, start, end } = req.query;
  
  try {
    // First, check which columns exist in audit_logs table
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'audit_logs' 
      AND table_schema = 'public'
    `);
    
    const availableColumns = columnCheck.rows.map(r => r.column_name);
    const hasDetails = availableColumns.includes('details');
    const hasIpAddress = availableColumns.includes('ip_address');
    
    console.log(`📋 Available columns in audit_logs:`, availableColumns.join(', '));
    
    // Build SELECT clause based on available columns
    let selectClause = `
      al.id,
      al.user_id,
      al.bill_id,
      al.action,
      al.entity,
      al.entity_id,
      al.timestamp
    `;
    
    // Add optional columns only if they exist
    if (hasDetails) {
      selectClause += `, al.details`;
    }
    if (hasIpAddress) {
      selectClause += `, al.ip_address`;
    }
    
    // Build username, role, and full name extraction - get from all possible tables
    // Determine user type based on which table has the user_id match
    let usernameExtraction = `
      COALESCE(
        ca.username,
        u.username,
        e.username
      ) as username,
      CASE
        WHEN ca.id IS NOT NULL THEN 'customer'
        WHEN u.id IS NOT NULL THEN COALESCE(u.role, 'user')
        WHEN e.id IS NOT NULL THEN COALESCE(e.role, 'employee')
        ELSE NULL
      END as user_role,
      CASE
        WHEN ca.id IS NOT NULL THEN TRIM(
          COALESCE(ca.first_name, '') || 
          CASE WHEN ca.middle_name IS NOT NULL AND ca.middle_name != '' THEN ' ' || ca.middle_name ELSE '' END ||
          ' ' || COALESCE(ca.last_name, '')
        )
        WHEN u.id IS NOT NULL THEN TRIM(COALESCE(u.name, ''))
        WHEN e.id IS NOT NULL THEN TRIM(COALESCE(e.first_name || ' ' || e.last_name, ''))
        ELSE NULL
      END as full_name
    `;
    
    if (hasDetails) {
      usernameExtraction = `
        COALESCE(
          ca.username,
          u.username,
          e.username,
          CASE 
            WHEN al.details IS NOT NULL AND jsonb_typeof(al.details) = 'object' 
            THEN al.details->>'username'
            ELSE NULL
          END
        ) as username,
        COALESCE(
          CASE
            WHEN ca.id IS NOT NULL THEN 'customer'
            WHEN u.id IS NOT NULL THEN u.role
            WHEN e.id IS NOT NULL THEN e.role
            ELSE NULL
          END,
          CASE 
            WHEN al.details IS NOT NULL AND jsonb_typeof(al.details) = 'object' 
            THEN al.details->>'role'
            ELSE NULL
          END
        ) as user_role,
        COALESCE(
          CASE
            WHEN ca.id IS NOT NULL THEN TRIM(
              COALESCE(ca.first_name, '') || 
              CASE WHEN ca.middle_name IS NOT NULL AND ca.middle_name != '' THEN ' ' || ca.middle_name ELSE '' END ||
              ' ' || COALESCE(ca.last_name, '')
            )
            WHEN u.id IS NOT NULL THEN TRIM(COALESCE(u.name, ''))
            WHEN e.id IS NOT NULL THEN TRIM(COALESCE(e.first_name || ' ' || e.last_name, ''))
            ELSE NULL
          END,
          CASE 
            WHEN al.details IS NOT NULL AND jsonb_typeof(al.details) = 'object' 
            THEN al.details->>'name'
            ELSE NULL
          END
        ) as full_name
      `;
    }
    
    // Build query with LEFT JOINs to get username from different tables
    let query = `
      SELECT 
        ${selectClause},
        ${usernameExtraction}
      FROM audit_logs al
      LEFT JOIN customer_accounts ca ON al.user_id = ca.id
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN employees e ON al.user_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let idx = 1;

    if (user_id) { query += ` AND al.user_id = $${idx++}`; params.push(user_id); }
    if (action) { query += ` AND al.action ILIKE $${idx++}`; params.push(`%${action}%`); }
    if (bill_id) { query += ` AND al.bill_id = $${idx++}`; params.push(bill_id); }
    if (name) { 
      query += ` AND (
        CASE
          WHEN ca.id IS NOT NULL THEN (ca.first_name || ' ' || COALESCE(ca.middle_name || '', '') || ' ' || ca.last_name) ILIKE $${idx}
          WHEN u.id IS NOT NULL THEN u.name ILIKE $${idx}
          WHEN e.id IS NOT NULL THEN (e.first_name || ' ' || e.last_name) ILIKE $${idx}
          ELSE NULL
        END
      )`;
      params.push(`%${name}%`);
      idx++;
    }
    if (start) { query += ` AND al.timestamp >= $${idx++}`; params.push(start); }
    if (end) { query += ` AND al.timestamp <= $${idx++}`; params.push(end); }

    // Increase limit to 500 and ensure we get recent entries
    query += ' ORDER BY al.timestamp DESC LIMIT 500';

    const { rows } = await pool.query(query, params);
    console.log(`✅ Returning ${rows.length} audit log entries`);
    
    // Log the most recent entry timestamp for debugging
    if (rows.length > 0) {
      const mostRecent = rows[0];
      console.log(`📅 Most recent entry: ${mostRecent.timestamp} (action: ${mostRecent.action}, user_id: ${mostRecent.user_id}, username: ${mostRecent.username || 'N/A'})`);
      
      // Log login entries specifically
      const loginEntries = rows.filter(r => r.action && r.action.toLowerCase() === 'login');
      if (loginEntries.length > 0) {
        console.log(`🔐 Found ${loginEntries.length} login entries. Most recent login: ${loginEntries[0].timestamp}`);
      }
    } else {
      console.log(`⚠️ No audit log entries found`);
    }
    
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch audit logs', details: error.message });
  }
});

router.get('/test', (req, res) => {
  res.send('Audit log test route works!');
});

module.exports = router; 
