const express = require('express');
const router = express.Router();
const creditController = require('../controllers/creditController');
const { authenticateToken } = require('../../middleware/auth');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Get customer credit information and transactions
router.get('/customer/:customerId', creditController.getCustomerCredits);

// Add credit to customer account
router.post('/add', creditController.addCredit);

// Deduct credit from customer account
router.post('/deduct', creditController.deductCredit);

// Adjust customer credit balance (manual adjustment)
router.post('/adjust', creditController.adjustCredit);

// Get all customers with credit balances
router.get('/customers', creditController.getCustomersWithCredits);

// Apply customer credit to bill payment
router.post('/apply-to-bill', creditController.applyCreditToBill);

module.exports = router;

