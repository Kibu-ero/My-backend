const express = require('express');
const pool = require('../db');
const router = express.Router();

// Get audit logs (optionally filter by user, action, date, bill)
router.get('/', async (req, res) => {
  console.log("GET /api/audit-logs hit");
  const { user_id, action, bill_id, start, end } = req.query;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  let idx = 1;

  if (user_id) { query += ` AND user_id = $${idx++}`; params.push(user_id); }
  if (action) { query += ` AND action ILIKE $${idx++}`; params.push(`%${action}%`); }
  if (bill_id) { query += ` AND bill_id = $${idx++}`; params.push(bill_id); }
  if (start) { query += ` AND timestamp >= $${idx++}`; params.push(start); }
  if (end) { query += ` AND timestamp <= $${idx++}`; params.push(end); }

  // Increase limit to 500 and ensure we get recent entries
  query += ' ORDER BY timestamp DESC LIMIT 500';

  try {
    const { rows } = await pool.query(query, params);
    console.log(`✅ Returning ${rows.length} audit log entries`);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.get('/test', (req, res) => {
  res.send('Audit log test route works!');
});

module.exports = router; 
