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
    
    // Get customer info for audit log
    let customerInfo = null;
    try {
      const billResult = await pool.query(
        'SELECT customer_id FROM billing WHERE bill_id = $1',
        [billId]
      );
      if (billResult.rows.length > 0) {
        const customerResult = await pool.query(
          'SELECT first_name, last_name FROM customer_accounts WHERE id = $1',
          [billResult.rows[0].customer_id]
        );
        if (customerResult.rows.length > 0) {
          customerInfo = `${customerResult.rows[0].first_name} ${customerResult.rows[0].last_name}`;
        }
      }
    } catch (err) {
      console.warn('Could not fetch customer info for audit log:', err.message);
    }
    
    // Audit log
    try {
      const { logAudit } = require('../utils/auditLogger');
      await logAudit({
        user_id: req.user?.id || null,
        action: status === 'Paid' ? 'payment_approved' : status === 'Rejected' ? 'payment_rejected' : 'bill_status_updated',
        entity: 'billing',
        entity_id: billId,
        details: {
          status: status,
          customer_name: customerInfo,
          reviewed_by: req.user?.username || req.user?.first_name || 'System'
        },
        ip_address: req.ip || req.connection?.remoteAddress || null
      });
      console.log(`✅ Audit log created for bill status update: Bill ${billId}, Status: ${status}, Customer: ${customerInfo}`);
    } catch (auditError) {
      console.error('❌ Failed to create audit log:', auditError.message);
      // Don't fail the request if audit logging fails
    }

    res.json({ success: true, bill: result.rows[0] });
  } catch (error) {
    console.error('Error updating bill status:', error);
    res.status(500).json({ error: 'Error updating bill status' });
  }
});

module.exports = router;
