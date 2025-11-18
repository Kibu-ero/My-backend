const express = require('express');
const pool = require('../db');
const router = express.Router();

// Get audit logs (optionally filter by user, action, date, bill)
router.get('/', async (req, res) => {
  console.log("GET /api/audit-logs hit");
  const { user_id, action, bill_id, start, end } = req.query;
  
  // Build query with LEFT JOINs to get username from different tables
  let query = `
    SELECT 
      al.*,
      COALESCE(
        ca.username,
        u.username,
        e.username
      ) as username
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
  if (start) { query += ` AND al.timestamp >= $${idx++}`; params.push(start); }
  if (end) { query += ` AND al.timestamp <= $${idx++}`; params.push(end); }

  // Increase limit to 500 and ensure we get recent entries
  query += ' ORDER BY al.timestamp DESC LIMIT 500';

  try {
    const { rows } = await pool.query(query, params);
    console.log(`✅ Returning ${rows.length} audit log entries`);
    
    // Log the most recent entry timestamp for debugging
    if (rows.length > 0) {
      console.log(`📅 Most recent entry: ${rows[0].timestamp} (action: ${rows[0].action}, user_id: ${rows[0].user_id})`);
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
