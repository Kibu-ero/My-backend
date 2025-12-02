const express = require("express");
const router = express.Router();
const customerController = require("../backend/src/controllers/CustomerController");

// Get all customers
router.get("/", customerController.getAllCustomers);

// Get customer by ID
router.get("/:id", customerController.getCustomerById);

// Add new customer
router.post("/", customerController.addCustomer);

// Update customer
router.put("/:id", customerController.updateCustomer);

// Update customer status
router.put("/:id/status", customerController.updateCustomerStatus);

module.exports = router;
