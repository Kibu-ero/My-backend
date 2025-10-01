const pool = require('../../db');
const { logAudit } = require('../../utils/auditLogger');

// Get all unpaid or pending bills
const getUnpaidBills = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM billing WHERE status = 'Pending'");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching unpaid bills:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Mark a bill as paid and return payment details
const markBillAsPaid = async (req, res) => {
  const { billId, paymentMethod } = req.body;

  if (!billId || !paymentMethod) {
    return res.status(400).json({ error: 'Bill ID and Payment Method are required' });
  }

  try {
    const updateQuery = "UPDATE billing SET status = 'Paid', payment_method = $1, payment_date = NOW() WHERE bill_id = $2 RETURNING *";
    const result = await pool.query(updateQuery, [paymentMethod, billId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const paidBill = result.rows[0];

    // Audit log: Bill marked as paid
    await logAudit({
      user_id: req.user && req.user.id,
      bill_id: billId,
      action: 'Marked Bill as Paid'
    });

    res.status(200).json({ message: 'Bill marked as paid successfully', bill: paidBill });
  } catch (error) {
    console.error('Error updating bill status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = { getUnpaidBills, markBillAsPaid };
