const bcrypt = require("bcryptjs");
const pool = require("../../db");
const { logAudit } = require("../../utils/auditLogger");

exports.createEmployee = async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, role } = req.body;

    const existingUsername = await pool.query("SELECT * FROM employees WHERE username = $1", [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ message: "Username is already in use." });
    }

    // Check if email already exists (if email provided)
    if (email && email.trim() !== '') {
      const existingUser = await pool.query("SELECT * FROM employees WHERE email = $1", [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ message: "Email is already in use." });
      }
    }

    // ✅ Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO employees (first_name, last_name, username, email, password, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [firstName, lastName, username, email || null, hashedPassword, role]
    );

    res.status(201).json({ message: "Employee account created successfully!" });

    // Audit
    try {
      await logAudit({
        user_id: req.user?.id || null,
        action: 'employee_created',
        entity: 'employees',
        entity_id: username,
        details: { firstName, lastName, username, role },
        ip_address: req.ip
      });
    } catch (_) {}
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
