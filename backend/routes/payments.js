const express = require("express");
const router = express.Router();
const paymentController = require("../src/controllers/paymentController");

// Get all unpaid or pending bills
router.get("/unpaid", paymentController.getUnpaidBills);

// Mark a bill as paid
router.put("/mark-paid/:id", paymentController.markBillAsPaid);

module.exports = router;
