const express = require('express');
const router = express.Router();
const authController = require('../backend/src/controllers/authController');
const { verifyToken } = require('../middleware/auth');

// Registration Route
router.post('/register', authController.register);

// Login Route
router.post('/login', authController.login);

// Token Verification Route
router.get('/verify', verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Restore real Approve Registration Route
router.post('/approve-registration', authController.approveRegistration);

module.exports = router;
