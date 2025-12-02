const express = require("express");
const {
  createBill,
  getAllBills,
  getBillByCustomerId,
  getBillById,
  updateBillStatus,
} = require("../src/controllers/billingController");
const { getAllCustomers } = require("../src/controllers/CustomerController");
const { verifyToken, requireRole } = require('../middleware/auth');
const pool = require('../db');
const router = express.Router();

// ✅ Create a new bill
router.post("/", createBill);

// ✅ Get all bills
router.get("/", getAllBills);

// ✅ Get all customers
router.get("/customers", getAllCustomers);

// ✅ Get bills by customer ID
router.get("/customer/:customerId", getBillByCustomerId);

// ✅ Get bill by ID (must come after more specific routes)
router.get("/:id", getBillById);

// ✅ Update bill status
router.put("/:billId", updateBillStatus);

// Mark a bill as paid
router.post('/mark-paid/:fileId', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    // Find the file and get the customer_id
    const fileResult = await pool.query(
      'SELECT * FROM customer_files WHERE id = $1',
      [req.params.fileId]
    );
    if (fileResult.rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const customerId = fileResult.rows[0].customer_id;

    // Update the latest unpaid bill for this customer as paid
    const updateResult = await pool.query(
      `UPDATE bills
       SET status = 'paid'
       WHERE customer_id = $1 AND status != 'paid'
       RETURNING *`,
      [customerId]
    );

    res.json({ message: 'Bill marked as paid', updated: updateResult.rows });
  } catch (error) {
    console.error('Error marking bill as paid:', error);
    res.status(500).json({ error: 'Error marking bill as paid' });
  }
});

module.exports = router;
