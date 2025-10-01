const pool = require("../../db");
const { logAudit } = require("../../utils/auditLogger");
const { sendSms } = require("../utils/sms");

// ✅ Create a New Bill
exports.createBill = async (req, res) => {
  try {
    // 1. Properly destructure req.body
    const { customer_id, meter_number, previous_reading, current_reading, due_date } = req.body;
    
    // 2. Validate required fields (now with proper variable names)
    if (!customer_id || !meter_number || !previous_reading || !current_reading || !due_date) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 3. Validate number formats
    const prevReading = parseFloat(previous_reading);
    const currReading = parseFloat(current_reading);
    
    if (isNaN(prevReading) || isNaN(currReading)) {
      return res.status(400).json({ message: "Readings must be valid numbers" });
    }

    if (currReading < prevReading) {
      return res.status(400).json({ message: "Current reading must be greater than or equal to previous reading" });
    }

    // 4. Calculate water consumption
    const consumption = currReading - prevReading;

    // Fetch customer birthdate
    const customerResult = await pool.query(
      'SELECT birthdate FROM customer_accounts WHERE id = $1',
      [customer_id]
    );
    if (customerResult.rows.length === 0) {
      return res.status(400).json({ message: 'Customer not found' });
    }
    const birthdate = customerResult.rows[0].birthdate;
    const today = new Date();
    const birthDateObj = new Date(birthdate);
    let age = today.getFullYear() - birthDateObj.getFullYear();
    const m = today.getMonth() - birthDateObj.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDateObj.getDate())) {
      age--;
    }
    // Hardcoded rate table for up to 100 cu.m.
    const rateTable = {
      10: 267, 11: 295, 12: 323, 13: 351, 14: 379, 15: 407, 16: 435, 17: 463, 18: 491, 19: 519, 20: 547,
      21: 577, 22: 607, 23: 637, 24: 667, 25: 697, 26: 727, 27: 757, 28: 787, 29: 817, 30: 847, 31: 879,
      32: 911, 33: 943, 34: 975, 35: 1007, 36: 1039, 37: 1071, 38: 1103, 39: 1135, 40: 1167, 41: 1202,
      42: 1237, 43: 1271, 44: 1305, 45: 1340, 46: 1374, 47: 1408, 48: 1443, 49: 1477, 50: 1512, 51: 1547,
      52: 1581, 53: 1616, 54: 1650, 55: 1685, 56: 1719, 57: 1753, 58: 1788, 59: 1822, 60: 1857, 61: 1891,
      62: 1925, 63: 1960, 64: 1994, 65: 2029, 66: 2063, 67: 2098, 68: 2132, 69: 2166, 70: 2201, 71: 2235,
      72: 2270, 73: 2304, 74: 2339, 75: 2373, 76: 2408, 77: 2442, 78: 2477, 79: 2511, 80: 2546, 81: 2580,
      82: 2615, 83: 2649, 84: 2684, 85: 2718, 86: 2753, 87: 2787, 88: 2822, 89: 2856, 90: 2891, 91: 2925,
      92: 2960, 93: 2994, 94: 3029, 95: 3063, 96: 3098, 97: 3132, 98: 3166, 99: 3201, 100: 3235
    };
    let amount_due = 0;
    if (consumption <= 100) {
      // Use the closest lower integer in the rate table
      const rounded = Math.floor(consumption);
      amount_due = rateTable[rounded] || 0;
    } else {
      // Beyond 100 cu.m. formula
      const excess = consumption - 100;
      amount_due = (excess * 34.45) + 3235;
    }
    // Senior citizen discount
    if (age >= 60) {
      amount_due = amount_due * 0.95;
    }

    // 5. Check customer credit balance before creating bill
    const creditResult = await pool.query(
      'SELECT credit_balance FROM customer_accounts WHERE id = $1',
      [customer_id]
    );
    
    const customerCreditBalance = parseFloat(creditResult.rows[0]?.credit_balance || 0);
    let finalAmountDue = amount_due;
    let billStatus = 'Unpaid';
    let creditApplied = 0;
    
    // Auto-apply credit if customer has sufficient balance
    if (customerCreditBalance > 0 && customerCreditBalance >= amount_due) {
      // Customer has enough credit to pay the full bill
      creditApplied = amount_due;
      finalAmountDue = 0;
      billStatus = 'Paid';
    } else if (customerCreditBalance > 0) {
      // Customer has partial credit
      creditApplied = customerCreditBalance;
      finalAmountDue = amount_due - customerCreditBalance;
      billStatus = 'Partially Paid';
    }

    // 6. Insert the new bill with calculated amount and status
    const result = await pool.query(
      `INSERT INTO billing 
       (customer_id, meter_number, previous_reading, current_reading, amount_due, due_date, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [customer_id, meter_number, prevReading, currReading, finalAmountDue, due_date, billStatus]
    );

    // 7. Apply credit deduction if credit was used
    if (creditApplied > 0) {
      const newCreditBalance = customerCreditBalance - creditApplied;
      
      // Update customer credit balance
      await pool.query(
        'UPDATE customer_accounts SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newCreditBalance, customer_id]
      );
      
      // Record credit transaction
      await pool.query(
        `INSERT INTO customer_credit_transactions 
         (customer_id, transaction_type, amount, previous_balance, new_balance, 
          description, reference_type, reference_id, created_by)
         VALUES ($1, 'debit', $2, $3, $4, $5, 'bill_payment', $6, $7)`,
        [customer_id, creditApplied, customerCreditBalance, newCreditBalance, 
         `Credit applied to bill ${result.rows[0].bill_id}`, result.rows[0].bill_id, req.user?.id]
      );
      
      // Record payment in cashier_billing if bill is fully paid
      if (billStatus === 'Paid') {
        await pool.query(
          `INSERT INTO cashier_billing 
           (customer_id, bill_id, payment_date, payment_method, amount_paid, 
            receipt_number, status, created_by)
           VALUES ($1, $2, CURRENT_TIMESTAMP, 'Credit', $3, 
                   'CREDIT-' || $2 || '-' || EXTRACT(EPOCH FROM NOW())::bigint, 'Paid', $4)`,
          [customer_id, result.rows[0].bill_id, creditApplied, req.user?.id]
        );
      }
    }

    // 8. Get the newly created bill with customer name
    const newBill = await pool.query(`
      SELECT b.*, CONCAT(c.first_name, ' ', c.last_name) as customer_name 
      FROM billing b
      JOIN customer_accounts c ON b.customer_id = c.id
      WHERE b.bill_id = $1
    `, [result.rows[0].bill_id]);

    // Log audit trail
    await logAudit({
      user_id: req.user?.id || null,
      bill_id: result.rows[0].bill_id,
      action: 'bill_created'
    });

    // Audit log for bill creation
    try {
      await logAudit({
        user_id: req.user?.id || null,
        action: 'bill_created',
        entity: 'billing',
        entity_id: result.rows[0].bill_id,
        details: {
          customer_id: customer_id,
          amount_due: finalAmountDue,
          credit_applied: creditApplied,
          status: billStatus
        },
        ip_address: req.ip
      });
    } catch (_) {}

    // Prepare response message
    let responseMessage = "Bill created successfully";
    if (creditApplied > 0) {
      if (billStatus === 'Paid') {
        responseMessage += ` and fully paid with credit (₱${creditApplied})`;
      } else {
        responseMessage += ` and partially paid with credit (₱${creditApplied}). Remaining balance: ₱${finalAmountDue}`;
      }
    }

    // Notify customer via SMS (best-effort)
    try {
      const customerPhone = customerResult.rows[0]?.phone_number;
      if (customerPhone) {
        const due = new Date(due_date).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
        const amountStr = (Math.round(finalAmountDue * 100) / 100).toFixed(2);
        await sendSms({
          to: customerPhone,
          text: `Billink: New bill #${result.rows[0].bill_id} issued for ₱${amountStr}. Due on ${due}.`
        });
      }
    } catch (smsErr) {
      console.warn('SMS send (new bill) failed:', smsErr.message);
    }

    res.status(201).json({ 
      message: responseMessage, 
      bill: newBill.rows[0],
      creditApplied: creditApplied,
      billStatus: billStatus
    });
  } catch (error) {
    console.error(`❌ Error in createBill:`, error);
    res.status(500).json({ 
      message: "Internal Server Error",
      error: error.message
    });
  }
};
// ✅ Get All Bills with Customer Names, Birthdate, and Payment Info
exports.getAllBills = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.*, 
        CONCAT(c.first_name, ' ', c.last_name) as customer_name, 
        c.birthdate,
        cb.receipt_number,
        cb.payment_date,
        cb.amount_paid,
        cb.penalty_paid
      FROM billing b
      JOIN customer_accounts c ON b.customer_id = c.id
      LEFT JOIN cashier_billing cb ON b.bill_id = cb.bill_id
      ORDER BY b.created_at DESC
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`❌ Error in getAllBills:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Get Bill by Customer ID with Name
exports.getBillByCustomerId = async (req, res) => {
  const { customerId } = req.params;
  const { status } = req.query;

  try {
    let query = `
      SELECT b.*, CONCAT(c.first_name, ' ', c.last_name) as customer_name 
      FROM billing b
      JOIN customer_accounts c ON b.customer_id = c.id
      WHERE b.customer_id = $1
    `;
    const values = [customerId];

    if (status) {
      query += " AND b.status = $2";
      values.push(status);
    }

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No bills found for this customer." });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`❌ Error in getBillByCustomerId:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Get Bill by ID
exports.getBillById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT b.*, CONCAT(c.first_name, ' ', c.last_name) as customer_name 
      FROM billing b
      JOIN customer_accounts c ON b.customer_id = c.id
      WHERE b.bill_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Bill not found." });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error(`❌ Error in getBillById:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Update Bill Status
exports.updateBillStatus = async (req, res) => {
  const { billId } = req.params;
  const { status } = req.body;
  const userId = req.user ? req.user.id : null;

  try {
    const result = await pool.query(
      `UPDATE billing SET status = $1, updated_at = NOW() 
       WHERE bill_id = $2 
       RETURNING *`,
      [status, billId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Bill not found." });
    }

    // Insert audit log
    await pool.query(
      `INSERT INTO audit_logs (bill_id, user_id, action, timestamp) VALUES ($1, $2, $3, NOW())`,
      [billId, userId, status]
    );

    res.status(200).json({ message: "Bill status updated successfully", bill: result.rows[0] });
  } catch (error) {
    console.error(`❌ Error in updateBillStatus:`, error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};