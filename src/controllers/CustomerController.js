const pool = require("../../db");
const bcrypt = require("bcrypt");

// Get all customers
const getAllCustomers = async (req, res) => {
  try {
    const query = `
      SELECT id, 
             first_name, 
             last_name,
             street,
             barangay,
             city,
             province,
             birthdate,
             meter_number,
             email,
             phone_number,
             senior_citizen,
             status,
             created_at
      FROM customer_accounts
      ORDER BY id;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get customer by ID
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, 
             first_name, 
             last_name,
             street,
             barangay,
             city,
             province,
             birthdate,
             meter_number,
             email,
             phone_number,
             senior_citizen,
             status,
             created_at
      FROM customer_accounts
      WHERE id = $1;
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching customer by ID:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Add new customer
const addCustomer = async (req, res) => {
  const {
    first_name,
    last_name,
    username,
    street,
    barangay,
    city,
    province,
    birthdate,
    meter_number,
    email,
    phone_number,
    password,
    status
  } = req.body;

  // Validate required fields (email is now optional)
  if (!first_name || !last_name || !username || !street || !barangay || !city || !province || 
      !birthdate || !meter_number || !phone_number || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Validate birthdate and calculate age
  const today = new Date();
  const birthDate = new Date(birthdate);
  
  if (birthDate > today) {
    return res.status(400).json({ error: "Birthdate cannot be in the future." });
  }
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  if (age < 0 || age > 120) {
    return res.status(400).json({ error: "Please enter a valid birthdate." });
  }
  
  // Determine if user is a senior citizen (60+ years old)
  const isSeniorCitizen = age >= 60;

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO customer_accounts 
        (first_name, last_name, username, street, barangay, city, province, 
         birthdate, meter_number, email, phone_number, password, senior_citizen, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, first_name, last_name, username, street, barangay, city, province,
                birthdate, meter_number, email, phone_number, senior_citizen, status;
    `;
    const result = await pool.query(query, [
      first_name,
      last_name,
      username,
      street,
      barangay,
      city,
      province,
      birthdate,
      meter_number,
      email || null, // Allow null email
      phone_number,
      hashedPassword,
      isSeniorCitizen,
      status || 'Active'
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding customer:", error);
    if (error.code === '23505') { // Unique violation
      if (error.constraint === 'customer_accounts_username_key') {
        return res.status(400).json({ error: "Username already exists" });
      }
      if (error.constraint === 'customer_accounts_email_key') {
        return res.status(400).json({ error: "Email already exists" });
      }
      if (error.constraint === 'customer_accounts_meter_number_key') {
        return res.status(400).json({ error: "Meter number already exists" });
      }
      if (error.constraint === 'customer_accounts_phone_number_key') {
        return res.status(400).json({ error: "Phone number already exists" });
      }
    }
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update customer
const updateCustomer = async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    last_name,
    street,
    barangay,
    city,
    province,
    birthdate,
    meter_number,
    email,
    phone_number,
    status
  } = req.body;

  // Validate required fields
  if (!first_name || !last_name || !street || !barangay || !city || !province || 
      !birthdate || !meter_number || !email || !phone_number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Validate birthdate and calculate age
  const today = new Date();
  const birthDate = new Date(birthdate);
  
  if (birthDate > today) {
    return res.status(400).json({ error: "Birthdate cannot be in the future." });
  }
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  if (age < 0 || age > 120) {
    return res.status(400).json({ error: "Please enter a valid birthdate." });
  }
  
  // Determine if user is a senior citizen (60+ years old)
  const isSeniorCitizen = age >= 60;

  try {
    const query = `
      UPDATE customer_accounts 
      SET first_name = $1,
          last_name = $2,
          street = $3,
          barangay = $4,
          city = $5,
          province = $6,
          birthdate = $7,
          meter_number = $8,
          email = $9,
          phone_number = $10,
          senior_citizen = $11,
          status = $12
      WHERE id = $13
      RETURNING id, first_name, last_name, street, barangay, city, province,
                birthdate, meter_number, email, phone_number, senior_citizen, status;
    `;
    const result = await pool.query(query, [
      first_name,
      last_name,
      street,
      barangay,
      city,
      province,
      birthdate,
      meter_number,
      email,
      phone_number,
      isSeniorCitizen,
      status || 'Active',
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating customer:", error);
    if (error.code === '23505') { // Unique violation
      if (error.constraint === 'customer_accounts_email_key') {
        return res.status(400).json({ error: "Email already exists" });
      }
      if (error.constraint === 'customer_accounts_meter_number_key') {
        return res.status(400).json({ error: "Meter number already exists" });
      }
      if (error.constraint === 'customer_accounts_phone_number_key') {
        return res.status(400).json({ error: "Phone number already exists" });
      }
    }
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update customer status
const updateCustomerStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    const query = `
      UPDATE customer_accounts 
      SET status = $1 
      WHERE id = $2
      RETURNING id, first_name, last_name, street, barangay, city, province,
                birthdate, meter_number, email, phone_number, status;
    `;
    const result = await pool.query(query, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating customer status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  addCustomer,
  updateCustomer,
  updateCustomerStatus
};