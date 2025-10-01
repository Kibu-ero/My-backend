const pool = require("../../db");

/**
 * Get customer credit information
 * GET /api/credits/customer/:customerId
 */
exports.getCustomerCredits = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }

    // Get customer credit information
    const customerResult = await pool.query(`
      SELECT 
        id,
        first_name,
        last_name,
        meter_number,
        credit_balance,
        credit_limit,
        CONCAT(first_name, ' ', last_name) as customer_name
      FROM customer_accounts 
      WHERE id = $1
    `, [customerId]);

    if (customerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get recent credit transactions
    const transactionsResult = await pool.query(`
      SELECT 
        t.*,
        e.first_name || ' ' || e.last_name as created_by_name
      FROM customer_credit_transactions t
      LEFT JOIN employees e ON t.created_by = e.id
      WHERE t.customer_id = $1
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [customerId]);

    res.status(200).json({
      success: true,
      data: {
        customer: customerResult.rows[0],
        transactions: transactionsResult.rows
      }
    });

  } catch (error) {
    console.error('❌ Error getting customer credits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get customer credit information',
      error: error.message
    });
  }
};

/**
 * Add credit to customer account
 * POST /api/credits/add
 */
exports.addCredit = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { customerId, amount, description, referenceType, referenceId } = req.body;
    let createdBy = req.user?.id || null;

    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and positive amount are required'
      });
    }

    // Get current customer information
    const customerResult = await client.query(`
      SELECT id, first_name, last_name, credit_balance, credit_limit
      FROM customer_accounts 
      WHERE id = $1
    `, [customerId]);

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const customer = customerResult.rows[0];
    const previousBalance = parseFloat(customer.credit_balance) || 0;
    const creditAmount = parseFloat(amount);
    const newBalance = previousBalance + creditAmount;

    // If createdBy provided, ensure it references an existing employee; otherwise null it out
    if (createdBy) {
      const employeeCheck = await client.query('SELECT id FROM employees WHERE id = $1', [createdBy]);
      if (employeeCheck.rows.length === 0) {
        createdBy = null;
      }
    }

    // Update customer credit balance
    await client.query(`
      UPDATE customer_accounts 
      SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newBalance, customerId]);

    // Record transaction
    const transactionResult = await client.query(`
      INSERT INTO customer_credit_transactions 
      (customer_id, transaction_type, amount, previous_balance, new_balance, 
       description, reference_type, reference_id, created_by)
      VALUES ($1, 'credit', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      customerId,
      creditAmount,
      previousBalance,
      newBalance,
      description || null,
      referenceType || 'manual_credit',
      referenceId || null,
      createdBy
    ]);

    await client.query('COMMIT');
    try {
      const { logAudit } = require('../../utils/auditLogger');
      await logAudit({
        user_id: createdBy || null,
        action: 'credit_added',
        entity: 'customer_credit_transactions',
        entity_id: transactionResult.rows[0]?.id,
        details: { customerId, amount: creditAmount, previousBalance, newBalance, description },
        ip_address: req.ip
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: `Credit of ₱${amount} added successfully`,
      data: {
        transaction: transactionResult.rows[0],
        newBalance: newBalance
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error adding credit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add credit',
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  } finally {
    client.release();
  }
};

/**
 * Deduct credit from customer account
 * POST /api/credits/deduct
 */
exports.deductCredit = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { customerId, amount, description, referenceType, referenceId } = req.body;
    const createdBy = req.user?.id;

    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and positive amount are required'
      });
    }

    // Get current customer information
    const customerResult = await client.query(`
      SELECT id, first_name, last_name, credit_balance, credit_limit
      FROM customer_accounts 
      WHERE id = $1
    `, [customerId]);

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const customer = customerResult.rows[0];
    const previousBalance = parseFloat(customer.credit_balance) || 0;
    const newBalance = previousBalance - parseFloat(amount);

    // Check if sufficient balance
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Insufficient credit balance',
        currentBalance: previousBalance,
        requestedAmount: amount
      });
    }

    // Update customer credit balance
    await client.query(`
      UPDATE customer_accounts 
      SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newBalance, customerId]);

    // Record transaction
    const transactionResult = await client.query(`
      INSERT INTO customer_credit_transactions 
      (customer_id, transaction_type, amount, previous_balance, new_balance, 
       description, reference_type, reference_id, created_by)
      VALUES ($1, 'debit', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [customerId, amount, previousBalance, newBalance, description, 
        referenceType, referenceId, createdBy]);

    await client.query('COMMIT');
    try {
      const { logAudit } = require('../../utils/auditLogger');
      await logAudit({
        user_id: createdBy || null,
        action: 'credit_deducted',
        entity: 'customer_credit_transactions',
        entity_id: transactionResult.rows[0]?.id,
        details: { customerId, amount, previousBalance, newBalance, description },
        ip_address: req.ip
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: `Credit of ₱${amount} deducted successfully`,
      data: {
        transaction: transactionResult.rows[0],
        newBalance: newBalance
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deducting credit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deduct credit',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Adjust customer credit balance (manual adjustment)
 * POST /api/credits/adjust
 */
exports.adjustCredit = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { customerId, newBalance, reason } = req.body;
    const createdBy = req.user?.id;

    if (!customerId || newBalance === undefined || newBalance < 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and valid new balance are required'
      });
    }

    // Get current customer information
    const customerResult = await client.query(`
      SELECT id, first_name, last_name, credit_balance
      FROM customer_accounts 
      WHERE id = $1
    `, [customerId]);

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const customer = customerResult.rows[0];
    const previousBalance = parseFloat(customer.credit_balance) || 0;
    const adjustmentAmount = parseFloat(newBalance) - previousBalance;

    // Update customer credit balance
    await client.query(`
      UPDATE customer_accounts 
      SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newBalance, customerId]);

    // Record transaction
    const transactionResult = await client.query(`
      INSERT INTO customer_credit_transactions 
      (customer_id, transaction_type, amount, previous_balance, new_balance, 
       description, reference_type, created_by)
      VALUES ($1, 'adjustment', $2, $3, $4, $5, 'manual_adjustment', $6)
      RETURNING *
    `, [customerId, adjustmentAmount, previousBalance, newBalance, 
        reason || 'Manual balance adjustment', createdBy]);

    await client.query('COMMIT');
    try {
      const { logAudit } = require('../../utils/auditLogger');
      await logAudit({
        user_id: createdBy || null,
        action: 'credit_adjusted',
        entity: 'customer_credit_transactions',
        entity_id: transactionResult.rows[0]?.id,
        details: { customerId, newBalance, previousBalance, adjustmentAmount, reason },
        ip_address: req.ip
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: `Credit balance adjusted to ₱${newBalance}`,
      data: {
        transaction: transactionResult.rows[0],
        previousBalance: previousBalance,
        newBalance: newBalance,
        adjustmentAmount: adjustmentAmount
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error adjusting credit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to adjust credit',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Get all customers with credit balances
 * GET /api/credits/customers
 */
exports.getCustomersWithCredits = async (req, res) => {
  try {
    const { minBalance = 0, maxBalance = null } = req.query;
    
    let query = `
      SELECT 
        id,
        first_name,
        last_name,
        meter_number,
        credit_balance,
        credit_limit,
        CONCAT(first_name, ' ', last_name) as customer_name,
        created_at
      FROM customer_accounts 
      WHERE credit_balance >= $1
    `;
    
    const params = [minBalance];
    
    if (maxBalance !== null) {
      query += ` AND credit_balance <= $2`;
      params.push(maxBalance);
    }
    
    query += ` ORDER BY credit_balance DESC`;

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Error getting customers with credits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get customers with credits',
      error: error.message
    });
  }
};

/**
 * Apply customer credit to bill payment
 * POST /api/credits/apply-to-bill
 */
exports.applyCreditToBill = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { customerId, billId, amount } = req.body;
    const createdBy = req.user?.id;

    if (!customerId || !billId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID, Bill ID, and positive amount are required'
      });
    }

    // Get customer and bill information
    const customerResult = await client.query(`
      SELECT id, first_name, last_name, credit_balance
      FROM customer_accounts 
      WHERE id = $1
    `, [customerId]);

    const billResult = await client.query(`
      SELECT bill_id, amount_due, status, penalty
      FROM billing 
      WHERE bill_id = $1
    `, [billId]);

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    const customer = customerResult.rows[0];
    const bill = billResult.rows[0];
    const previousBalance = parseFloat(customer.credit_balance) || 0;
    const newBalance = previousBalance - parseFloat(amount);

    // Check if sufficient balance
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Insufficient credit balance',
        currentBalance: previousBalance,
        requestedAmount: amount
      });
    }

    // Check if bill is already paid
    if (bill.status === 'Paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Bill is already paid'
      });
    }

    // Update customer credit balance
    await client.query(`
      UPDATE customer_accounts 
      SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newBalance, customerId]);

    // Record credit transaction
    await client.query(`
      INSERT INTO customer_credit_transactions 
      (customer_id, transaction_type, amount, previous_balance, new_balance, 
       description, reference_type, reference_id, created_by)
      VALUES ($1, 'debit', $2, $3, $4, $5, 'bill_payment', $6, $7)
    `, [customerId, amount, previousBalance, newBalance, 
        `Credit applied to bill ${billId}`, billId, createdBy]);

    // Record payment in cashier_billing
    await client.query(`
      INSERT INTO cashier_billing 
      (customer_id, bill_id, payment_date, payment_method, amount_paid, 
       receipt_number, status, created_by)
      VALUES ($1, $2, CURRENT_TIMESTAMP, 'Credit', $3, 
              'CREDIT-' || $2 || '-' || EXTRACT(EPOCH FROM NOW())::bigint, 'Paid', $4)
    `, [customerId, billId, amount, createdBy]);

    // Update bill status
    await client.query(`
      UPDATE billing 
      SET status = 'Paid', updated_at = CURRENT_TIMESTAMP
      WHERE bill_id = $1
    `, [billId]);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Credit of ₱${amount} applied to bill ${billId}`,
      data: {
        newBalance: newBalance,
        billId: billId,
        paymentAmount: amount
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error applying credit to bill:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply credit to bill',
      error: error.message
    });
  } finally {
    client.release();
  }
};

