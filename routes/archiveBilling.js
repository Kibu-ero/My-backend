const express = require('express');
const router = express.Router();
const pool = require('../db');

// Archive a bill by setting archived = true
router.put('/billing/:id/archive', async (req, res) => {
  try {
    await pool.query('UPDATE billing SET archived = true WHERE bill_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to archive bill', error: err.message });
  }
});

module.exports = router; 
