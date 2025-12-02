const express = require('express');
const { getCustomerBills } = require('../backend/src/controllers/billsController');

const router = express.Router();

// GET /api/bills/:customerId
router.get('/:customerId', getCustomerBills);

module.exports = router;
