const express = require("express");
const router = express.Router();
const { createEmployee } = require("../backend/src/controllers/employeeController");

router.post("/", createEmployee);

module.exports = router;
