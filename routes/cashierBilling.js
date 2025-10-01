const express = require('express');
const { addPayment, fetchPayments, fetchUnpaidBills, fetchPaymentsByCustomer } = require('../src/controllers/cashierBillingController');
const { verifyToken, requireRole } = require('../middleware/auth');
const pool = require('../db');
const router = express.Router();

// Payment routes
router.post('/add', addPayment);
router.get('/all', fetchPayments);
router.get('/unpaid', fetchUnpaidBills);
router.get('/customer/:customerId', fetchPaymentsByCustomer);

// Payment proof routes
router.get('/payment-proofs', verifyToken, requireRole('cashier'), async (req, res) => {
  try {
    console.log('Cashier requesting payment proofs...');
    const result = await pool.query(
      `SELECT cf.*, ca.first_name, ca.last_name, ca.email
       FROM customer_files cf
       JOIN customer_accounts ca ON cf.customer_id = ca.id
       ORDER BY cf.created_at DESC`
    );
    console.log('Payment proofs fetched for cashier:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payment proofs:', error);
    res.status(500).json({ error: 'Error fetching payment proofs' });
  }
});

// Update bill status (approve/reject payment)
router.put('/bills/:billId/status', verifyToken, requireRole('cashier'), async (req, res) => {
  try {
    const { billId } = req.params;
    const { status } = req.body;
    
    if (!['Paid', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const result = await pool.query(
      'UPDATE billing SET status = $1, updated_at = NOW() WHERE bill_id = $2 RETURNING *',
      [status, billId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    // Audit
    try {
      const { logAudit } = require('../src/utils/auditLogger');
      await logAudit({
        user_id: req.user?.id || null,
        action: status === 'Paid' ? 'payment_approved' : status === 'Rejected' ? 'payment_rejected' : 'bill_status_updated',
        entity: 'billing',
        entity_id: billId,
        details: { status },
        ip_address: req.ip
      });
    } catch (_) {}

    res.json({ success: true, bill: result.rows[0] });
  } catch (error) {
    console.error('Error updating bill status:', error);
    res.status(500).json({ error: 'Error updating bill status' });
  }
});

module.exports = router;