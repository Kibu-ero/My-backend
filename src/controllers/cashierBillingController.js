const db = require('../../db');
const { logAudit } = require('../../utils/auditLogger');

// Add Payment
const addPayment = async (req, res) => {
  try {
    const {
      customer_id,
      bill_id,
      payment_date,
      payment_method,
      amount_paid,
      penalty_paid = 0,
      change_given = 0,
      receipt_number,
      status = 'Paid',
    } = req.body;

    // Log the request body for debugging
    console.log('Request Body:', req.body);

    // Validate required fields
    if (!customer_id || !bill_id || !amount_paid || !receipt_number) {
      console.error('Missing required fields:', { customer_id, bill_id, amount_paid, receipt_number });
      return res.status(400).json({ 
        success: false,
        message: "Missing required fields: customer_id, bill_id, amount_paid, or receipt_number." 
      });
    }

    // Validate data types
    if (isNaN(parseFloat(amount_paid))) {
      return res.status(400).json({ 
        success: false,
        message: "amount_paid must be a valid number." 
      });
    }

    // Check if a payment with the same bill_id already exists
    const existingPayment = await db.query(
      'SELECT * FROM cashier_billing WHERE bill_id = $1',
      [bill_id]
    );

    if (existingPayment.rows.length > 0) {
      console.error('Duplicate payment detected for bill_id:', bill_id);
      return res.status(400).json({ 
        success: false,
        message: "Payment for this bill already exists." 
      });
    }

    const query = `
      INSERT INTO cashier_billing 
      (customer_id, bill_id, payment_date, payment_method, amount_paid, penalty_paid, change_given, receipt_number, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;

    const values = [
      customer_id,
      bill_id,
      payment_date || new Date().toISOString(),
      payment_method || 'Cash',
      parseFloat(amount_paid),
      parseFloat(penalty_paid || 0),
      parseFloat(change_given || 0),
      receipt_number,
      status,
    ];

    // Log the query and values for debugging
    console.log('Executing Query:', query);
    console.log('With Values:', values);

    const result = await db.query(query, values);
    
    // Get customer info for audit log
    let customerInfo = null;
    try {
      const customerResult = await db.query(
        'SELECT first_name, last_name FROM customer_accounts WHERE id = $1',
        [customer_id]
      );
      if (customerResult.rows.length > 0) {
        customerInfo = `${customerResult.rows[0].first_name} ${customerResult.rows[0].last_name}`;
      }
    } catch (err) {
      console.warn('Could not fetch customer info for audit log:', err.message);
    }
    
    // Update the billing status to paid in the billing table
    try {
      await db.query(
        'UPDATE billing SET status = $1 WHERE bill_id = $2',
        ['Paid', bill_id]
      );
      console.log(`Updated billing status for bill_id: ${bill_id}`);
    } catch (updateError) {
      console.error('Warning: Could not update billing status:', updateError.message);
      // Continue with the response, since the payment was recorded
    }
    
    // Audit log: Payment processed
    try {
      // Get user ID from token if available
      let userId = null;
      if (req.user?.id) {
        userId = req.user.id;
      } else if (req.headers.authorization) {
        // Try to extract user from token if middleware didn't set req.user
        try {
          const jwt = require('jsonwebtoken');
          const token = req.headers.authorization.replace('Bearer ', '');
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
          userId = decoded.userId || decoded.id;
        } catch (tokenError) {
          console.warn('Could not extract user from token:', tokenError.message);
        }
      }
      
      await logAudit({
        user_id: userId,
        bill_id: bill_id,
        action: 'payment_processed',
        entity: 'cashier_billing',
        entity_id: result.rows[0].id || bill_id,
        details: {
          bill_id: bill_id,
          customer_id: customer_id,
          customer_name: customerInfo,
          amount_paid: parseFloat(amount_paid),
          penalty_paid: parseFloat(penalty_paid || 0),
          payment_method: payment_method || 'Cash',
          receipt_number: receipt_number,
          total_amount: parseFloat(amount_paid) + parseFloat(penalty_paid || 0)
        },
        ip_address: req.ip || req.connection?.remoteAddress || null
      });
      console.log(`✅ Audit log created for payment: Bill ${bill_id}, Amount: ₱${amount_paid}, User: ${userId || 'N/A'}`);
    } catch (auditError) {
      console.error('❌ Failed to create audit log for payment:', auditError.message);
      console.error('Stack:', auditError.stack);
      // Don't fail the request if audit logging fails
    }
    
    res.status(201).json({ success: true, payment: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // PostgreSQL unique violation error code
      console.error('Duplicate key violation:', error.detail);
      return res.status(400).json({ 
        success: false,
        message: "Duplicate key detected: " + error.detail 
      });
    }
    console.error('Error adding payment:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Failed to add payment: ' + error.message });
  }
};

// Get All Payments
const fetchPayments = async (req, res) => {
  try {
    const query = 'SELECT * FROM cashier_billing';
    const result = await db.query(query);
    res.status(200).json({ success: true, payments: result.rows });
  } catch (error) {
    console.error('Error fetching payments:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch payments.' });
  }
};

// Fixed: Fetch Unpaid Bills from billing table
const fetchUnpaidBills = async (req, res) => {
  try {
    // Query to fetch all unpaid bills from the billing table with customer information
    const query = `
      SELECT 
        b.bill_id,
        b.customer_id,
        b.meter_number,
        b.previous_reading,
        b.current_reading,
        b.amount_due AS amount,
        b.due_date,
        b.status,
        b.created_at AS billing_date,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name
      FROM 
        billing b
      JOIN 
        customer_accounts c ON b.customer_id = c.id
      WHERE 
        b.status = 'Unpaid'
      ORDER BY
        b.due_date ASC
    `;

    const result = await db.query(query);
    
    if (result.rows.length === 0) {
      return res.status(200).json({ success: true, bills: [] });
    }

    res.status(200).json({ 
      success: true, 
      bills: result.rows.map(bill => ({
        bill_id: bill.bill_id,
        customer_id: bill.customer_id,
        customer_name: bill.customer_name || `Customer ${bill.customer_id}`,
        meter_number: bill.meter_number,
        previous_reading: bill.previous_reading,
        current_reading: bill.current_reading,
        amount: bill.amount,
        status: bill.status,
        billing_date: bill.billing_date,
        due_date: bill.due_date
      }))
    });
  } catch (error) {
    console.error('Error fetching unpaid bills:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch unpaid bills',
      error: error.message
    });
  }
};

// Get Payments by Customer ID
const fetchPaymentsByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer ID is required.' });
    }
    const query = 'SELECT * FROM cashier_billing WHERE customer_id = $1 ORDER BY payment_date DESC';
    const result = await db.query(query, [customerId]);
    res.status(200).json({ success: true, payments: result.rows });
  } catch (error) {
    console.error('Error fetching payments by customer:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch payments for customer.' });
  }
};

// Update bill status (approve/reject payment)
const updateBillStatus = async (req, res) => {
  try {
    const { billId } = req.params;
    const { status } = req.body;
    const userId = req.user ? req.user.id : null;
    
    if (!['Paid', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const result = await db.query(
      'UPDATE billing SET status = $1 WHERE bill_id = $2 RETURNING *',
      [status, billId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    // Get customer info for audit log
    let customerInfo = null;
    try {
      const billResult = await db.query(
        'SELECT customer_id FROM billing WHERE bill_id = $1',
        [billId]
      );
      if (billResult.rows.length > 0) {
        const customerResult = await db.query(
          'SELECT first_name, last_name FROM customer_accounts WHERE id = $1',
          [billResult.rows[0].customer_id]
        );
        if (customerResult.rows.length > 0) {
          customerInfo = `${customerResult.rows[0].first_name} ${customerResult.rows[0].last_name}`;
        }
      }
    } catch (err) {
      console.warn('Could not fetch customer info for audit log:', err.message);
    }
    
    // Audit log using logAudit function
    try {
      await logAudit({
        user_id: userId,
        action: status === 'Paid' ? 'payment_approved' : status === 'Rejected' ? 'payment_rejected' : 'bill_status_updated',
        entity: 'billing',
        entity_id: billId,
        details: {
          status: status,
          customer_name: customerInfo
        },
        ip_address: req.ip || req.connection?.remoteAddress || null
      });
    } catch (auditError) {
      console.error('❌ Failed to create audit log:', auditError.message);
      // Don't fail the request if audit logging fails
    }
    
    res.json({ success: true, bill: result.rows[0] });
  } catch (error) {
    console.error('Error updating bill status:', error);
    res.status(500).json({ error: 'Error updating bill status' });
  }
};

module.exports = {
  addPayment,
  fetchPayments,
  fetchUnpaidBills,
  fetchPaymentsByCustomer,
  updateBillStatus,
};
