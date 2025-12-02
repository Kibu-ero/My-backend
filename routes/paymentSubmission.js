const express = require('express');
const multer = require('multer');
const { submitPaymentProof, getCustomerSubmissions } = require('../backend/src/controllers/paymentSubmissionController');

const router = express.Router();
const upload = multer({ dest: 'uploads/tmp/' });

// Submit payment proof with screenshot
router.post('/submit', upload.single('paymentProof'), (req, res, next) => {
  console.log('POST /submit request received:', req.body);
  next();
}, submitPaymentProof);

// Get customer's payment submissions
router.get('/customer/:customerId', (req, res, next) => {
  console.log('GET /customer/:customerId request received:', req.params);
  next();
}, getCustomerSubmissions);

module.exports = router;
