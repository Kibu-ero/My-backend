const express = require('express');
const router = express.Router();
const db = require('../db'); // Adjust path if needed

// Helper: Get today's date in YYYY-MM-DD
function getToday() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

router.get('/dashboard-stats', async (req, res) => {
  try {
    // 1. Total employees
    const empResult = await db.query('SELECT COUNT(*) FROM employees');
    const employees = parseInt(empResult.rows[0].count, 10);

    // 2. Today's revenue from billing table
    const today = getToday();
    const revResult = await db.query(
      `SELECT COALESCE(SUM(amount_due), 0) AS total
       FROM billing
       WHERE status = 'Paid' AND updated_at::date = $1`, [today]
    );
    const revenue = parseFloat(revResult.rows[0].total);

    // 3. Pending approvals (bills with status 'Pending')
    const pendResult = await db.query(
      `SELECT COUNT(*) FROM billing WHERE status = 'Pending'`
    );
    const pending = parseInt(pendResult.rows[0].count, 10);

    res.json({ employees, revenue, pending });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

router.get('/employees', async (req, res) => {
  try {
    const result = await db.query('SELECT id, first_name, last_name, email, role FROM employees');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

module.exports = router;