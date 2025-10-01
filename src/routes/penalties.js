const express = require('express');
const router = express.Router();
const penaltyController = require('../controllers/penaltyController');
const { authenticateToken } = require('../../middleware/auth');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Process all overdue bills and apply penalties
router.get('/process', penaltyController.processPenalties);

// Get penalty summary for a specific bill
router.get('/bill/:billId', penaltyController.getBillPenalty);

// Calculate penalty for given parameters
router.post('/calculate', penaltyController.calculatePenalty);

// Get all overdue bills with penalty information
router.get('/overdue', penaltyController.getOverdueBills);

module.exports = router;
