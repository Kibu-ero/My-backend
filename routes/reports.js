const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const db = require('../db');
const authMiddleware = require('../middleware/authmiddleware');

// Test endpoint to check database connection (no auth required) - MUST BE BEFORE AUTH MIDDLEWARE
router.get('/test-db', async (req, res) => {
  try {
    // Test basic database connection and check data in each table
    const queries = [
      'SELECT COUNT(*) as count FROM customer_accounts',
      'SELECT COUNT(*) as count FROM bills',
      'SELECT COUNT(*) as count FROM cashier_billing',
      'SELECT COUNT(*) as count FROM payment_submissions',
      'SELECT COUNT(*) as count FROM billing'
    ];
    
    const results = {};
    for (let i = 0; i < queries.length; i++) {
      const result = await pool.query(queries[i]);
      const tableName = queries[i].split('FROM ')[1];
      results[tableName] = result.rows[0].count;
    }
    
    // Get sample data from each table to understand the structure
    const sampleData = {};
    
    if (results.customer_accounts > 0) {
      const customers = await pool.query('SELECT id, first_name, last_name, meter_number, status FROM customer_accounts LIMIT 3');
      sampleData.customers = customers.rows;
    }
    
    if (results.bills > 0) {
      const bills = await pool.query('SELECT id, customer_id, amount_due, status, due_date, payment_date FROM bills LIMIT 3');
      sampleData.bills = bills.rows;
    }
    
    if (results.cashier_billing > 0) {
      const cashierBilling = await pool.query('SELECT id, customer_id, amount_paid, payment_date, payment_method FROM cashier_billing LIMIT 3');
      sampleData.cashier_billing = cashierBilling.rows;
    }
    
    if (results.payment_submissions > 0) {
      const paymentSubmissions = await pool.query('SELECT id, customer_id, amount, payment_method, created_at, status FROM payment_submissions LIMIT 3');
      sampleData.payment_submissions = paymentSubmissions.rows;
    }
    
    if (results.billing > 0) {
      const billing = await pool.query('SELECT bill_id, customer_id, amount_due, status, due_date FROM billing LIMIT 3');
      sampleData.billing = billing.rows;
    }
    
    // Also get all data from cashier_billing to see what we're working with
    const allCashierData = await pool.query('SELECT * FROM cashier_billing LIMIT 5');
    const allSubmissionData = await pool.query('SELECT * FROM payment_submissions LIMIT 5');
    
    res.json({ 
      message: 'Database connection successful',
      tableCounts: results,
      sampleData: sampleData,
      allCashierData: allCashierData.rows,
      allSubmissionData: allSubmissionData.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Database test failed:', err);
    res.status(500).json({ 
      error: 'Database connection failed',
      details: err.message 
    });
  }
});

// Middleware to check if user has permission to access reports
const checkReportAccess = (req, res, next) => {
  const rawRole = req.user && req.user.role ? String(req.user.role) : '';
  const userRole = rawRole.toLowerCase().replace(/\s+/g, '_');
  console.log('CheckReportAccess - User role:', rawRole, '->', userRole);
  
  // Allow common finance role variants and others
  const allowedRoles = new Set([
    'admin',
    'cashier',
    'encoder',
    'finance_officer',
    'finance_manager',
    'finance',
    'manager',
    'finance_manager_dashboard',
    'customer'
  ]);
  
  if (!allowedRoles.has(userRole)) {
    console.log('Access denied for role:', userRole);
    return res.status(403).json({ error: 'Access denied to reports', role: rawRole });
  }
  
  console.log('Access granted for role:', userRole);
  next();
};

// Middleware to check admin-only access (audit logs, approval tracking)
const checkAdminAccess = (req, res, next) => {
  const userRole = req.user.role;
  
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Middleware to filter data based on user role
const filterDataByRole = (userRole, data, type) => {
  switch (userRole) {
    case 'admin':
      return data; // Full access
    case 'cashier':
      if (type === 'audit' || type === 'approvals') {
        return []; // No access to audit or approval data
      }
      return data; // Access to financial data
    case 'encoder':
      if (type === 'audit' || type === 'approvals' || type === 'transactions') {
        return []; // No access to audit, approval, or transaction data
      }
      return data.filter(item => item.type === 'bill' || item.description?.includes('Bill')); // Only billing data
    default:
      return [];
  }
};

// Apply authentication and permission middleware to all routes
router.use(authenticateToken, checkReportAccess);

// Test endpoint to check authentication (requires auth)
router.get('/test-auth', async (req, res) => {
  res.json({ 
    message: 'Authentication successful',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Collection Summary Report
router.get('/collection', async (req, res) => {
  console.log('Collection report requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    console.log('Collection report params:', { startDate, endDate });
    
    // PostgreSQL query to get actual payment collections
    let query;
    let params = [];
    
    if (startDate && endDate) {
      // Use date filters for PostgreSQL with your actual schema
      query = `
      SELECT 
          payment_date::date as date,
          SUM(amount_paid) as totalCollected,
          COUNT(*) as paymentCount,
          AVG(amount_paid) as averageAmount,
          'Cashier Payment' as source
        FROM cashier_billing
        WHERE payment_date::date BETWEEN $1::date AND $2::date
        GROUP BY payment_date::date
        
        UNION ALL
        
        SELECT 
          created_at::date as date,
        SUM(amount) as totalCollected,
        COUNT(*) as paymentCount,
          AVG(amount) as averageAmount,
          'Online Payment' as source
        FROM payment_submissions
        WHERE status = 'approved' AND created_at::date BETWEEN $1::date AND $2::date
        GROUP BY created_at::date
        
        ORDER BY date DESC
      `;
      params = [startDate, endDate];
    } else {
      // Show recent data without date filters
      query = `
        SELECT 
          payment_date::date as date,
          SUM(amount_paid) as totalCollected,
          COUNT(*) as paymentCount,
          AVG(amount_paid) as averageAmount,
          'Cashier Payment' as source
        FROM cashier_billing
        WHERE payment_date IS NOT NULL
        GROUP BY payment_date::date
        
        UNION ALL
        
        SELECT 
          created_at::date as date,
          SUM(amount) as totalCollected,
          COUNT(*) as paymentCount,
          AVG(amount) as averageAmount,
          'Online Payment' as source
        FROM payment_submissions
        WHERE status = 'approved' AND created_at IS NOT NULL
        GROUP BY created_at::date
        
        ORDER BY date DESC
        LIMIT 30
      `;
    }
    
    console.log('Executing PostgreSQL query:', query);
    console.log('Query params:', params);
    const result = await pool.query(query, params);
    console.log('Collection report result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching collection report:', err);
    res.status(500).json({ message: 'Error fetching collection report', error: err.message });
  }
});

// Enhanced Collection Summary with Period Aggregation
router.get('/collection-summary', async (req, res) => {
  console.log('Enhanced collection summary requested by user:', req.user);
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    console.log('Collection summary params:', { startDate, endDate, groupBy });
    
    // Determine the date format based on groupBy parameter
    let dateFormat;
    let dateGrouping;
    
    switch (groupBy) {
      case 'year':
        dateFormat = 'YYYY';
        dateGrouping = 'EXTRACT(YEAR FROM payment_date)';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        dateGrouping = "TO_CHAR(payment_date, 'YYYY-MM')";
        break;
      case 'week':
        dateFormat = 'YYYY-"W"WW';
        dateGrouping = "TO_CHAR(payment_date, 'YYYY-\"W\"WW')";
        break;
      case 'day':
      default:
        dateFormat = 'YYYY-MM-DD';
        dateGrouping = 'DATE(payment_date)';
        break;
    }
    
    let query = `
      WITH collection_data AS (
        -- Cashier payments
        SELECT 
          ${dateGrouping} as period,
          'Cashier Payment' as source,
          SUM(amount_paid) as total_amount,
          COUNT(*) as transaction_count,
          AVG(amount_paid) as average_amount
        FROM cashier_billing 
        WHERE payment_date IS NOT NULL
        ${startDate && endDate ? 'AND payment_date BETWEEN $1 AND $2' : ''}
        GROUP BY ${dateGrouping}
        
        UNION ALL
        
        -- Payment submissions
        SELECT 
          ${dateGrouping.replace('payment_date', 'created_at')} as period,
          'Online Payment' as source,
          SUM(amount) as total_amount,
          COUNT(*) as transaction_count,
          AVG(amount) as average_amount
        FROM payment_submissions
        WHERE created_at IS NOT NULL
        ${startDate && endDate ? 'AND created_at BETWEEN $1 AND $2' : ''}
        GROUP BY ${dateGrouping.replace('payment_date', 'created_at')}
      )
      SELECT 
        period,
        SUM(total_amount) as totalCollected,
        SUM(transaction_count) as paymentCount,
        AVG(average_amount) as averageAmount,
        COUNT(DISTINCT source) as sourceCount
      FROM collection_data
      GROUP BY period
      ORDER BY period DESC
      LIMIT 50
    `;
    
    const params = startDate && endDate ? [startDate, endDate] : [];
    
    console.log('Executing enhanced query:', query);
    console.log('Query params:', params);
    const result = await pool.query(query, params);
    
    // Add summary statistics
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount_paid) as total_collections,
        AVG(amount_paid) as average_payment,
        MIN(amount_paid) as min_payment,
        MAX(amount_paid) as max_payment
      FROM cashier_billing
      WHERE payment_date IS NOT NULL
      ${startDate && endDate ? 'AND payment_date BETWEEN $1 AND $2' : ''}
    `;
    
    const summaryResult = await pool.query(summaryQuery, params);
    
    console.log('Collection summary result:', result.rows);
    res.json({
      data: result.rows,
      summary: summaryResult.rows[0],
      period: groupBy,
      dateRange: { startDate, endDate }
    });
  } catch (err) {
    console.error('Error fetching collection summary:', err);
    res.status(500).json({ message: 'Error fetching collection summary' });
  }
});





// Audit Logs Report (Admin only)
router.get('/audit', checkAdminAccess, async (req, res) => {
  console.log('Audit logs requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    console.log('Audit logs params:', { startDate, endDate });
    
    // Create audit log from actual system activities
    let query = `
      SELECT 
        'Bill Created' as action,
        'Admin' as user_name,
        'Created bill ID: ' || b.id || ' for customer ' || ca.first_name || ' ' || ca.last_name as description,
        b.created_at as timestamp,
        'bills' as table_name,
        'Success' as status
      FROM bills b
      LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
      WHERE b.created_at IS NOT NULL
      ${startDate && endDate ? 'AND b.created_at BETWEEN $1::timestamp AND $2::timestamp' : ''}
      
      UNION ALL
      
      SELECT 
        'Payment Processed' as action,
        'Cashier' as user_name,
        'Processed payment of ₱' || cb.amount_paid || ' for customer ' || ca.first_name || ' ' || ca.last_name as description,
        cb.created_at as timestamp,
        'cashier_billing' as table_name,
        cb.status as status
      FROM cashier_billing cb
      LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
      WHERE cb.created_at IS NOT NULL
      ${startDate && endDate ? 'AND cb.created_at BETWEEN $1::timestamp AND $2::timestamp' : ''}
      
      UNION ALL
      
      SELECT 
        'Payment Submission' as action,
        ca.first_name || ' ' || ca.last_name as user_name,
        'Submitted online payment of ₱' || ps.amount || ' via ' || ps.payment_method as description,
        ps.created_at as timestamp,
        'payment_submissions' as table_name,
        ps.status as status
      FROM payment_submissions ps
      LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
      WHERE ps.created_at IS NOT NULL
      ${startDate && endDate ? 'AND ps.created_at BETWEEN $1::timestamp AND $2::timestamp' : ''}
      
      ORDER BY timestamp DESC
      LIMIT 100
    `;
    
    const params = startDate && endDate ? [startDate, endDate] : [];
    const result = await pool.query(query, params);
    
    console.log('Audit logs result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ message: 'Error fetching audit logs', error: err.message });
  }
});

// Approval Logs Report (Admin/Finance only)
router.get('/approvals', async (req, res) => {
  console.log('Approval logs requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    console.log('Approval logs params:', { startDate, endDate });
    
    // Get payment submission approval history
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
        SELECT 
          ps.id as submission_id,
          ps.customer_id,
          ps.amount,
          ps.status,
          ps.payment_method,
          ps.created_at as submission_date,
          ps.updated_at as approval_date,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          CASE 
            WHEN ps.status = 'approved' THEN 'Payment Approved'
            WHEN ps.status = 'rejected' THEN 'Payment Rejected'
            ELSE 'Payment Pending'
          END as action,
          CASE 
            WHEN ps.status = 'pending' THEN 'Awaiting Review'
            WHEN ps.status = 'approved' THEN 'Approved by Cashier'
            WHEN ps.status = 'rejected' THEN 'Rejected - Invalid Documentation'
            ELSE ps.status
          END as approval_notes
        FROM payment_submissions ps
        LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at BETWEEN $1::timestamp AND $2::timestamp
        ORDER BY ps.updated_at DESC, ps.created_at DESC
        LIMIT 100
      `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          ps.id as submission_id,
          ps.customer_id,
          ps.amount,
          ps.status,
          ps.payment_method,
          ps.created_at as submission_date,
          ps.updated_at as approval_date,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          CASE 
            WHEN ps.status = 'approved' THEN 'Payment Approved'
            WHEN ps.status = 'rejected' THEN 'Payment Rejected'
            ELSE 'Payment Pending'
          END as action,
          CASE 
            WHEN ps.status = 'pending' THEN 'Awaiting Review'
            WHEN ps.status = 'approved' THEN 'Approved by Cashier'
            WHEN ps.status = 'rejected' THEN 'Rejected - Invalid Documentation'
            ELSE ps.status
          END as approval_notes
        FROM payment_submissions ps
        LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at IS NOT NULL
        ORDER BY ps.updated_at DESC, ps.created_at DESC
        LIMIT 50
      `;
    }
    
    const result = await pool.query(query, params);
    
    console.log('Approval logs result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching approval logs:', err);
    res.status(500).json({ message: 'Error fetching approval logs', error: err.message });
  }
});

// Transaction Logs Report
router.get('/transactions', async (req, res) => {
  console.log('Transaction logs requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    console.log('Transaction logs params:', { startDate, endDate });
    
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
        SELECT 
          cb.id as transaction_id,
          cb.customer_id,
          cb.amount_paid,
          cb.payment_date::text as payment_date,
          cb.payment_method,
          cb.receipt_number,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          'Cashier Payment' as transaction_type,
          cb.status
        FROM cashier_billing cb
        LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
        WHERE cb.payment_date IS NOT NULL
          AND cb.payment_date::date BETWEEN $1::date AND $2::date
        
        UNION ALL
        
        SELECT 
          ps.id as transaction_id,
          ps.customer_id,
          ps.amount as amount_paid,
          ps.created_at::text as payment_date,
          ps.payment_method,
          'Online-' || ps.id as receipt_number,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          'Online Payment' as transaction_type,
          ps.status
        FROM payment_submissions ps
        LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at IS NOT NULL
          AND ps.created_at::date BETWEEN $1::date AND $2::date
        
        ORDER BY payment_date DESC
        LIMIT 100
      `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          cb.id as transaction_id,
          cb.customer_id,
          cb.amount_paid,
          cb.payment_date::text as payment_date,
          cb.payment_method,
          cb.receipt_number,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          'Cashier Payment' as transaction_type,
          cb.status
        FROM cashier_billing cb
        LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
        WHERE cb.payment_date IS NOT NULL
        
        UNION ALL
        
        SELECT 
          ps.id as transaction_id,
          ps.customer_id,
          ps.amount as amount_paid,
          ps.created_at::text as payment_date,
          ps.payment_method,
          'Online-' || ps.id as receipt_number,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          'Online Payment' as transaction_type,
          ps.status
        FROM payment_submissions ps
        LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at IS NOT NULL
        
        ORDER BY payment_date DESC
        LIMIT 50
      `;
    }
    
    const result = await pool.query(query, params);
    
    console.log('Transaction logs result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transaction logs:', err);
    res.status(500).json({ message: 'Error fetching transaction logs', error: err.message });
  }
});

// Outstanding Balances Report
router.get('/outstanding', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Outstanding balances report params:', { startDate, endDate });
    
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
        SELECT 
          ca.first_name || ' ' || ca.last_name as customerName,
          ca.meter_number as accountNumber,
          b.amount_due as amountDue,
          b.due_date,
          b.status,
          GREATEST(0, (CURRENT_DATE - DATE(b.due_date))) as daysOverdue,
          (
            SELECT MAX(payment_date)
            FROM cashier_billing cb
            WHERE cb.customer_id = b.customer_id
          ) as lastPayment
        FROM billing b
        LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
        WHERE (b.status IN ('Unpaid','Overdue') OR DATE(b.due_date) < CURRENT_DATE)
          AND DATE(b.due_date) BETWEEN $1::date AND $2::date
        ORDER BY daysOverdue DESC
        LIMIT 100
      `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          ca.first_name || ' ' || ca.last_name as customerName,
          ca.meter_number as accountNumber,
          b.amount_due as amountDue,
          b.due_date,
          b.status,
          GREATEST(0, (CURRENT_DATE - DATE(b.due_date))) as daysOverdue,
          (
            SELECT MAX(payment_date)
            FROM cashier_billing cb
            WHERE cb.customer_id = b.customer_id
          ) as lastPayment
        FROM billing b
        LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
        WHERE (b.status IN ('Unpaid','Overdue') OR DATE(b.due_date) < CURRENT_DATE)
        ORDER BY daysOverdue DESC
        LIMIT 50
      `;
    }
    
    console.log('Executing outstanding query with params:', params);
    const result = await pool.query(query, params);
    console.log('Outstanding balances result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching outstanding balances:', err);
    res.status(500).json({ message: 'Error fetching outstanding balances', error: err.message });
  }
});

// Revenue Report
router.get('/revenue', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Revenue report params:', { startDate, endDate });
    
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
      SELECT 
          DATE_TRUNC('month', b.created_at) as month,
          SUM(b.amount_due) as totalRevenue,
          SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) as collectedAmount,
          SUM(b.amount_due) as billedAmount,
          CASE 
            WHEN SUM(b.amount_due) > 0 THEN 
              (SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) / SUM(b.amount_due)) * 100
            ELSE 0
          END as collectionRate
      FROM billing b
        WHERE b.created_at BETWEEN $1::timestamp AND $2::timestamp
        GROUP BY DATE_TRUNC('month', b.created_at)
      ORDER BY month DESC
    `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          DATE_TRUNC('month', b.created_at) as month,
          SUM(b.amount_due) as totalRevenue,
          SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) as collectedAmount,
          SUM(b.amount_due) as billedAmount,
          CASE 
            WHEN SUM(b.amount_due) > 0 THEN 
              (SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) / SUM(b.amount_due)) * 100
            ELSE 0
          END as collectionRate
        FROM billing b
        WHERE b.created_at IS NOT NULL
        GROUP BY DATE_TRUNC('month', b.created_at)
        ORDER BY month DESC
      `;
    }
    
    console.log('Executing revenue query with params:', params);
    const result = await pool.query(query, params);
    console.log('Revenue report result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching revenue report:', err);
    res.status(500).json({ message: 'Error fetching revenue report', error: err.message });
  }
});

// Monthly Statistics
router.get('/monthly-stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Monthly stats report params:', { startDate, endDate });
    
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
      SELECT 
          DATE_TRUNC('month', b.created_at) as month,
        COUNT(DISTINCT b.customer_id) as activeCustomers,
          SUM(b.amount_due) as totalBilled,
          SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) as totalCollected,
          COUNT(CASE WHEN b.status = 'Unpaid' OR b.status IS NULL THEN 1 END) as unpaidBills,
          AVG(b.amount_due) as averageBillAmount
      FROM billing b
        WHERE b.created_at BETWEEN $1::timestamp AND $2::timestamp
        GROUP BY DATE_TRUNC('month', b.created_at)
      ORDER BY month DESC
    `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          DATE_TRUNC('month', b.created_at) as month,
          COUNT(DISTINCT b.customer_id) as activeCustomers,
          SUM(b.amount_due) as totalBilled,
          SUM(CASE WHEN b.status = 'Paid' THEN b.amount_due ELSE 0 END) as totalCollected,
          COUNT(CASE WHEN b.status = 'Unpaid' OR b.status IS NULL THEN 1 END) as unpaidBills,
          AVG(b.amount_due) as averageBillAmount
        FROM billing b
        WHERE b.created_at IS NOT NULL
        GROUP BY DATE_TRUNC('month', b.created_at)
        ORDER BY month DESC
      `;
    }
    
    console.log('Executing monthly stats query with params:', params);
    const result = await pool.query(query, params);
    console.log('Monthly stats result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching monthly statistics:', err);
    res.status(500).json({ message: 'Error fetching monthly statistics', error: err.message });
  }
});

// Get available zones for billing sheet
// Daily Collector Billing Sheet - month/year and optional zone/collector
router.get('/daily-collector', async (req, res) => {
  try {
    const { month, year, collector, zone } = req.query; // month as 1-12 or name, year as 4-digit
    if (!month || !year) {
      return res.status(400).json({ error: 'month and year are required' });
    }

    // Normalize month to number 1-12
    const monthMap = {
      'JANUARY': 1,'FEBRUARY': 2,'MARCH': 3,'APRIL': 4,'MAY': 5,'JUNE': 6,
      'JULY': 7,'AUGUST': 8,'SEPTEMBER': 9,'OCTOBER': 10,'NOVEMBER': 11,'DECEMBER': 12
    };
    const m = isNaN(month) ? (monthMap[String(month).toUpperCase()] || 1) : parseInt(month, 10);
    const y = parseInt(year, 10);

    console.log('Daily collector query params:', { month: m, year: y, collector, zone });

    const params = [m, y];
    let whereFilter = '';
    
    // Support both collector (legacy) and zone parameter
    const filterValue = zone || collector;
    
    // If filter is provided and not 'ALL', add WHERE clause
    if (filterValue && filterValue.toUpperCase() !== 'ALL' && filterValue !== '') {
      params.push(filterValue);
      // Match by barangay or city (no b.zone column in current schema)
      whereFilter = ' AND (ca.barangay = $3 OR ca.city = $3)';
    }

    const query = `
      SELECT 
        COALESCE(NULLIF(TRIM(ca.barangay), ''), NULLIF(TRIM(ca.city), ''), '') AS zone,
        COALESCE(ca.first_name || ' ' || ca.last_name, '') AS name,
        TRIM(BOTH ', ' FROM COALESCE(ca.province,'') || ', ' || COALESCE(ca.city,'') || ', ' || COALESCE(ca.barangay,'')) AS address,
        CASE WHEN (DATE_PART('year', CURRENT_DATE) - DATE_PART('year', COALESCE(ca.birthdate, CURRENT_DATE))) >= 60 THEN 'SC' ELSE 'ACTIVE' END AS status1,
        COALESCE(ca.status,'') AS status2,
        COALESCE(b.current_reading,0) AS present_reading,
        COALESCE(b.previous_reading,0) AS previous_reading,
        COALESCE(b.current_reading,0) - COALESCE(b.previous_reading,0) AS used,
        COALESCE(b.amount_due,0) AS bill_amount,
        CASE WHEN (DATE_PART('year', CURRENT_DATE) - DATE_PART('year', COALESCE(ca.birthdate, CURRENT_DATE))) >= 60 THEN ROUND(COALESCE(b.amount_due,0) * 0.05,2) ELSE 0 END AS scd,
        GREATEST(COALESCE(b.amount_due,0) - (CASE WHEN (DATE_PART('year', CURRENT_DATE) - DATE_PART('year', COALESCE(ca.birthdate, CURRENT_DATE))) >= 60 THEN ROUND(COALESCE(b.amount_due,0) * 0.05,2) ELSE 0 END),0) AS total_amount,
        COALESCE(cb.receipt_number,'') AS or_number,
        TO_CHAR(COALESCE(cb.payment_date, b.due_date), 'MM-DD') AS pay_date,
        COALESCE(cb.penalty_paid,0) AS penalty,
        GREATEST(COALESCE(b.amount_due,0) + COALESCE(cb.penalty_paid,0) - (CASE WHEN (DATE_PART('year', CURRENT_DATE) - DATE_PART('year', COALESCE(ca.birthdate, CURRENT_DATE))) >= 60 THEN ROUND(COALESCE(b.amount_due,0) * 0.05,2) ELSE 0 END),0) AS after_due,
        0 AS surcharge
      FROM billing b
      LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
      LEFT JOIN cashier_billing cb ON cb.bill_id = b.bill_id
      WHERE EXTRACT(MONTH FROM b.created_at) = $1 AND EXTRACT(YEAR FROM b.created_at) = $2 ${whereFilter}
      ORDER BY ca.last_name, ca.first_name
    `;

    console.log('Executing query with params:', params);
    const result = await pool.query(query, params);
    console.log(`Query returned ${result.rows.length} rows`);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching daily collector sheet:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      query: err.query,
      parameters: err.parameters
    });
    res.status(500).json({ 
      error: 'Error fetching daily collector sheet',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

router.get('/billing-sheet-zones', async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ error: 'month and year are required' });
    }

    const monthMap = {
      'JANUARY': 1, 'FEBRUARY': 2, 'MARCH': 3, 'APRIL': 4, 'MAY': 5, 'JUNE': 6,
      'JULY': 7, 'AUGUST': 8, 'SEPTEMBER': 9, 'OCTOBER': 10, 'NOVEMBER': 11, 'DECEMBER': 12
    };
    const m = isNaN(month) ? (monthMap[String(month).toUpperCase()] || parseInt(month, 10)) : parseInt(month, 10);
    const y = parseInt(year, 10);

    const query = `
      SELECT DISTINCT 
        COALESCE(NULLIF(TRIM(ca.barangay), ''), NULLIF(TRIM(ca.city), ''), 'Unspecified') AS zone
      FROM billing b
      LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
      WHERE EXTRACT(MONTH FROM b.created_at) = $1 
        AND EXTRACT(YEAR FROM b.created_at) = $2
      ORDER BY zone
    `;

    const result = await pool.query(query, [m, y]);
    res.json(result.rows.map(row => row.zone));
  } catch (err) {
    console.error('Error fetching zones:', err);
    res.status(500).json({ message: 'Error fetching zones', error: err.message });
  }
});

// Export to Excel
router.get('/:reportType/export', async (req, res) => {
  try {
    const { reportType } = req.params;
    const { startDate, endDate } = req.query;
    
    let query;
    let filename;
    let sheetName;

    switch (reportType) {
      case 'collection':
        query = `
          SELECT 
            DATE(payment_date) as date,
            SUM(amount) as totalCollected,
            COUNT(*) as paymentCount,
            AVG(amount) as averageAmount
          FROM payments
          WHERE payment_date BETWEEN $1 AND $2
          GROUP BY DATE(payment_date)
          ORDER BY date DESC
        `;
        filename = 'collection-report';
        sheetName = 'Collection Summary';
        break;

      case 'outstanding':
        query = `
          SELECT 
            c.first_name || ' ' || c.last_name as customerName,
            c.account_number,
            b.amount as amountDue,
            DATE_PART('day', CURRENT_DATE - b.due_date) as daysOverdue,
            (
              SELECT MAX(payment_date)
              FROM payments p
              WHERE p.customer_id = c.id
            ) as lastPayment
          FROM bills b
          JOIN customers c ON b.customer_id = c.id
          WHERE b.status = 'Unpaid'
            AND b.due_date BETWEEN $1 AND $2
          ORDER BY daysOverdue DESC
        `;
        filename = 'outstanding-balances';
        sheetName = 'Outstanding Balances';
        break;

      case 'revenue':
        query = `
          SELECT 
            DATE_TRUNC('month', b.due_date) as month,
            SUM(b.amount) as totalRevenue,
            SUM(CASE WHEN b.status = 'Paid' THEN b.amount ELSE 0 END) as collectedAmount,
            SUM(b.amount) as billedAmount,
            SUM(CASE WHEN b.status = 'Paid' THEN b.amount ELSE 0 END) / NULLIF(SUM(b.amount), 0) as collectionRate
          FROM bills b
          WHERE b.due_date BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('month', b.due_date)
          ORDER BY month DESC
        `;
        filename = 'revenue-report';
        sheetName = 'Revenue Report';
        break;

      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    const result = await pool.query(query, [startDate, endDate]);
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    // Add headers
    const headers = Object.keys(result.rows[0] || {});
    worksheet.addRow(headers);

    // Add data
    result.rows.forEach(row => {
      worksheet.addRow(Object.values(row));
    });

    // Style the worksheet
    worksheet.getRow(1).font = { bold: true };
    worksheet.columns.forEach(column => {
      column.width = 15;
    });

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${filename}-${new Date().toISOString().split('T')[0]}.xlsx`
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error generating Excel report:', err);
    res.status(500).json({ message: 'Error generating Excel report' });
  }
});

// Overview Report
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get total bills
    const billsQuery = `
      SELECT COUNT(*) as "totalBills", COALESCE(SUM(amount_due), 0) as "totalRevenue"
      FROM billing 
      WHERE created_at BETWEEN $1::timestamp AND $2::timestamp
    `;
    
    // Get pending approvals
    const approvalsQuery = `
      SELECT COUNT(*) as "pendingApprovals"
      FROM approval_requests 
      WHERE status = 'pending' AND created_at BETWEEN $1::timestamp AND $2::timestamp
    `;
    
    // Get active customers
    const customersQuery = `
      SELECT COUNT(*) as "activeCustomers"
      FROM customer_accounts 
      WHERE status = 'active'
    `;

    const billsResult = await db.query(billsQuery, [startDate, endDate]);
    const approvalsResult = await db.query(approvalsQuery, [startDate, endDate]);
    const customersResult = await db.query(customersQuery);

    const overview = {
      totalBills: parseInt(billsResult.rows[0]?.totalBills) || 0,
      totalRevenue: parseFloat(billsResult.rows[0]?.totalRevenue) || 0,
      pendingApprovals: parseInt(approvalsResult.rows[0]?.pendingApprovals) || 0,
      activeCustomers: parseInt(customersResult.rows[0]?.activeCustomers) || 0
    };

    res.json(overview);
  } catch (error) {
    console.error('Error fetching overview report:', error);
    res.status(500).json({ error: 'Failed to fetch overview report', detail: error.message });
  }
});

// Customer Ledger
router.get('/ledger', async (req, res) => {
  try {
    const { startDate, endDate, customerId } = req.query;
    console.log('Customer ledger report params:', { startDate, endDate, customerId });

    const hasRange = Boolean(startDate && endDate);
    const params = [];

    // Bills (debits)
    let billsWhere = 'b.created_at IS NOT NULL';
    if (hasRange) {
      billsWhere += ` AND DATE(b.created_at) BETWEEN $${params.length + 1} AND $${params.length + 2}`;
      params.push(startDate, endDate);
    }
    if (customerId) {
      billsWhere += ` AND b.customer_id = $${params.length + 1}`;
      params.push(customerId);
    }

    // Payments (credits)
    let payWhere = 'cb.payment_date IS NOT NULL';
    if (hasRange) {
      payWhere += ` AND DATE(cb.payment_date) BETWEEN $${params.length + 1} AND $${params.length + 2}`;
      params.push(startDate, endDate);
    }
    if (customerId) {
      payWhere += ` AND cb.customer_id = $${params.length + 1}`;
      params.push(customerId);
    }

    const query = `
      SELECT 
        b.created_at::date AS date,
        ca.first_name || ' ' || ca.last_name AS "customerName",
        'Bill Generated' AS description,
        b.amount_due AS debit,
        0 AS credit
      FROM billing b
      JOIN customer_accounts ca ON b.customer_id = ca.id
      WHERE ${billsWhere}

      UNION ALL

      SELECT 
        cb.payment_date::date AS date,
        ca.first_name || ' ' || ca.last_name AS "customerName",
        'Payment Received' AS description,
        0 AS debit,
        cb.amount_paid AS credit
      FROM cashier_billing cb
      JOIN customer_accounts ca ON cb.customer_id = ca.id
      WHERE ${payWhere}

      ORDER BY date DESC
      LIMIT 500
    `;

    console.log('Executing ledger query with params:', params);
    const result = await pool.query(query, params);
    // Compute running balance on server if desired; for now return rows
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching customer ledger:', err);
    res.status(500).json({ error: 'Failed to fetch customer ledger', detail: err.message });
  }
});

// Audit Logs
router.get('/audit', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = `
      SELECT 
        created_at as timestamp,
        user_name as user,
        action,
        details,
        ip_address as "ipAddress"
      FROM audit_logs 
      WHERE created_at BETWEEN $1 AND $2
      ORDER BY created_at DESC
      LIMIT 1000
    `;

    const results = await db.query(query, [startDate, endDate]);
    res.json(results.rows);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Transaction Logs
router.get('/transactions', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Transaction logs report params:', { startDate, endDate });
    
    // Use cashier_billing and payment_submissions as transaction logs
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
        SELECT 
          payment_date as date,
          id as "transactionId",
          ca.first_name || ' ' || ca.last_name as "customerName",
          'Cashier Payment' as type,
          amount_paid as amount,
          status
        FROM cashier_billing cb
        JOIN customer_accounts ca ON cb.customer_id = ca.id
        WHERE cb.payment_date BETWEEN $1 AND $2
        
        UNION ALL
        
      SELECT 
        created_at as date,
        id as "transactionId",
          ca.first_name || ' ' || ca.last_name as "customerName",
          'Customer Payment' as type,
        amount,
        status
        FROM payment_submissions ps
        JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at BETWEEN $3 AND $4
        
        ORDER BY date DESC
      `;
      params = [startDate, endDate, startDate, endDate];
    } else {
      query = `
        SELECT 
          payment_date as date,
          id as "transactionId",
          ca.first_name || ' ' || ca.last_name as "customerName",
          'Cashier Payment' as type,
          amount_paid as amount,
          status
        FROM cashier_billing cb
        JOIN customer_accounts ca ON cb.customer_id = ca.id
        WHERE cb.payment_date IS NOT NULL
        
        UNION ALL
        
        SELECT 
          created_at as date,
          id as "transactionId",
          ca.first_name || ' ' || ca.last_name as "customerName",
          'Customer Payment' as type,
          amount,
          status
        FROM payment_submissions ps
        JOIN customer_accounts ca ON ps.customer_id = ca.id
        WHERE ps.created_at IS NOT NULL
        
        ORDER BY date DESC
    `;
    }
    
    console.log('Executing transactions query with params:', params);
    const result = await pool.query(query, params);
    console.log('Transaction logs result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transaction logs:', err);
    res.status(500).json({ error: 'Failed to fetch transaction logs' });
  }
});

// Approval Logs (using audit_logs table)
router.get('/approvals', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Approval logs report params:', { startDate, endDate });
    
    let query;
    let params = [];
    
    if (startDate && endDate) {
      query = `
      SELECT 
          timestamp as date,
          id as "requestId",
          'User ' || user_id as requestor,
          action as type,
          'System' as approver,
          CASE 
            WHEN action LIKE '%approve%' THEN 'Approved'
            WHEN action LIKE '%reject%' THEN 'Rejected'
            ELSE 'Pending'
          END as status
        FROM audit_logs 
        WHERE timestamp BETWEEN $1 AND $2
          AND (action LIKE '%approve%' OR action LIKE '%reject%' OR action LIKE '%request%')
        ORDER BY timestamp DESC
      `;
      params = [startDate, endDate];
    } else {
      query = `
        SELECT 
          timestamp as date,
          id as "requestId",
          'User ' || user_id as requestor,
          action as type,
          'System' as approver,
          CASE 
            WHEN action LIKE '%approve%' THEN 'Approved'
            WHEN action LIKE '%reject%' THEN 'Rejected'
            ELSE 'Pending'
          END as status
        FROM audit_logs 
        WHERE action LIKE '%approve%' OR action LIKE '%reject%' OR action LIKE '%request%'
        ORDER BY timestamp DESC
    `;
    }
    
    console.log('Executing approvals query with params:', params);
    const result = await pool.query(query, params);
    console.log('Approval logs result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching approval logs:', err);
    res.status(500).json({ error: 'Failed to fetch approval logs' });
  }
});

// Export Reports
router.post('/export/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, customerId } = req.body;
    
    // Implementation for exporting reports to CSV/PDF
    // This would generate and return a file download
    
    res.json({ message: `${type} report exported successfully` });
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// Overview Report
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get total bills
    const billsQuery = `
      SELECT COUNT(*) as "totalBills", COALESCE(SUM(amount_due), 0) as "totalRevenue"
      FROM billing 
      WHERE created_at BETWEEN $1::timestamp AND $2::timestamp
    `;
    
    // Get pending approvals
    const approvalsQuery = `
      SELECT COUNT(*) as "pendingApprovals"
      FROM approval_requests 
      WHERE status = 'pending' AND created_at BETWEEN $1::timestamp AND $2::timestamp
    `;
    
    // Get active customers
    const customersQuery = `
      SELECT COUNT(*) as "activeCustomers"
      FROM customer_accounts 
      WHERE status = 'active'
    `;

    const billsResult = await db.query(billsQuery, [startDate, endDate]);
    const approvalsResult = await db.query(approvalsQuery, [startDate, endDate]);
    const customersResult = await db.query(customersQuery);

    const overview = {
      totalBills: parseInt(billsResult.rows[0]?.totalBills) || 0,
      totalRevenue: parseFloat(billsResult.rows[0]?.totalRevenue) || 0,
      pendingApprovals: parseInt(approvalsResult.rows[0]?.pendingApprovals) || 0,
      activeCustomers: parseInt(customersResult.rows[0]?.activeCustomers) || 0
    };

    res.json(overview);
  } catch (error) {
    console.error('Error fetching overview report:', error);
    res.status(500).json({ error: 'Failed to fetch overview report', detail: error.message });
  }
});

// Customer Ledger
router.get('/ledger', async (req, res) => {
  console.log('Customer ledger requested by user:', req.user);
  try {
    const { startDate, endDate, customerId } = req.query;
    console.log('Customer ledger params:', { startDate, endDate, customerId });
    
    let query;
    let params = [];
    
    if (customerId) {
      // Specific customer ledger
      if (startDate && endDate) {
        query = `
      SELECT 
            'Bill' as transaction_type,
            b.id as reference_id,
            b.billing_date as transaction_date,
            b.amount_due as amount,
            b.status,
            'Debit' as type,
            ca.first_name || ' ' || ca.last_name as customer_name,
            ca.meter_number
      FROM bills b
          LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
          WHERE b.customer_id = $1 AND b.billing_date::date BETWEEN $2::date AND $3::date
          
      UNION ALL
          
      SELECT 
            'Payment' as transaction_type,
            cb.id as reference_id,
            cb.payment_date::date as transaction_date,
            cb.amount_paid as amount,
            cb.status,
            'Credit' as type,
            ca.first_name || ' ' || ca.last_name as customer_name,
            ca.meter_number
          FROM cashier_billing cb
          LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
          WHERE cb.customer_id = $1 AND cb.payment_date::date BETWEEN $2::date AND $3::date
          
          ORDER BY transaction_date DESC
        `;
        params = [customerId, startDate, endDate];
      } else {
        query = `
          SELECT 
            'Bill' as transaction_type,
            b.id as reference_id,
            b.billing_date as transaction_date,
            b.amount_due as amount,
            b.status,
            'Debit' as type,
            ca.first_name || ' ' || ca.last_name as customer_name,
            ca.meter_number
          FROM bills b
          LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
          WHERE b.customer_id = $1
          
          UNION ALL
          
          SELECT 
            'Payment' as transaction_type,
            cb.id as reference_id,
            cb.payment_date::date as transaction_date,
            cb.amount_paid as amount,
            cb.status,
            'Credit' as type,
            ca.first_name || ' ' || ca.last_name as customer_name,
            ca.meter_number
          FROM cashier_billing cb
          LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
          WHERE cb.customer_id = $1
          
          ORDER BY transaction_date DESC
          LIMIT 50
        `;
        params = [customerId];
      }
    } else {
      // All customers summary
      query = `
        SELECT 
          ca.id as customer_id,
          ca.first_name || ' ' || ca.last_name as customer_name,
          ca.meter_number,
          COALESCE(total_bills.amount, 0) as total_billed,
          COALESCE(total_payments.amount, 0) as total_paid,
          COALESCE(total_bills.amount, 0) - COALESCE(total_payments.amount, 0) as outstanding_balance
        FROM customer_accounts ca
        LEFT JOIN (
          SELECT customer_id, SUM(amount_due) as amount
          FROM bills
          GROUP BY customer_id
        ) total_bills ON ca.id = total_bills.customer_id
        LEFT JOIN (
          SELECT customer_id, SUM(amount_paid) as amount
          FROM cashier_billing
          GROUP BY customer_id
        ) total_payments ON ca.id = total_payments.customer_id
        ORDER BY outstanding_balance DESC
        LIMIT 100
      `;
    }
    
    const result = await pool.query(query, params);
    
    console.log('Customer ledger result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching customer ledger:', err);
    res.status(500).json({ message: 'Error fetching customer ledger', error: err.message });
  }
});

// Customer-specific reports (already implemented above in the main customer reports section)

// Audit Logs (Admin Only)
router.get('/audit', authMiddleware, checkAdminAccess, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = `
      SELECT 
        created_at as timestamp,
        user_name as user,
        action,
        details,
        ip_address as "ipAddress"
      FROM audit_logs 
      WHERE created_at BETWEEN $1 AND $2
      ORDER BY created_at DESC
      LIMIT 1000
    `;

    const results = await db.query(query, [startDate, endDate]);
    res.json(results.rows);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Transaction Logs
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = `
      SELECT 
        created_at as date,
        id as "transactionId",
        ca.last_name || ', ' || ca.first_name as "customerName",
        transaction_type as type,
        amount,
        status
      FROM transactions t
      JOIN customer_accounts ca ON t.customer_id = ca.id
      WHERE t.created_at BETWEEN $1 AND $2
      ORDER BY t.created_at DESC
    `;

    const results = await db.query(query, [startDate, endDate]);
    
    // Filter data based on user role
    const filteredData = filterDataByRole(req.user.role, results.rows, 'transactions');
    res.json(filteredData);
  } catch (error) {
    console.error('Error fetching transaction logs:', error);
    res.status(500).json({ error: 'Failed to fetch transaction logs' });
  }
});

// Approval Logs (Admin Only)
router.get('/approvals', authMiddleware, checkAdminAccess, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = `
      SELECT 
        ar.created_at as date,
        ar.id as "requestId",
        e.last_name || ', ' || e.first_name as requestor,
        ar.request_type as type,
        approver.last_name || ', ' || approver.first_name as approver,
        ar.status
      FROM approval_requests ar
      JOIN employees e ON ar.requestor_id = e.id
      LEFT JOIN employees approver ON ar.approver_id = approver.id
      WHERE ar.created_at BETWEEN $1 AND $2
      ORDER BY ar.created_at DESC
    `;

    const results = await db.query(query, [startDate, endDate]);
    res.json(results.rows);
  } catch (error) {
    console.error('Error fetching approval logs:', error);
    res.status(500).json({ error: 'Failed to fetch approval logs' });
  }
});

// Export Reports
router.post('/export/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, customerId } = req.body;
    
    // Check if user has permission to export this type of report
    if (type === 'audit' || type === 'approvals') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required for this report type' });
      }
    }
    
    // Implementation for exporting reports to CSV/PDF
    // This would generate and return a file download
    
    res.json({ message: `${type} report exported successfully` });
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// Billing Report
router.get('/billing', async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `
      SELECT 
        b.bill_id,
        ca.first_name || ' ' || ca.last_name AS customer,
        b.amount,
        b.status,
        b.due_date,
        b.paid_date
      FROM billing b
      JOIN customer_accounts ca ON b.customer_id = ca.id
    `;
    const params = [];
    if (from && to) {
      query += ' WHERE b.due_date BETWEEN $1 AND $2';
      params.push(from, to);
    }
    query += ' ORDER BY b.due_date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching billing report:', err);
    res.status(500).json({ error: 'Error fetching billing report' });
  }
});

// Payments Report
router.get('/payments', async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `
      SELECT 
        p.id,
        ca.first_name || ' ' || ca.last_name AS customer,
        p.amount,
        p.payment_method,
        p.created_at AS date,
        p.status
      FROM payment_submissions p
      JOIN customer_accounts ca ON p.customer_id = ca.id
    `;
    const params = [];
    if (from && to) {
      query += ' WHERE p.created_at BETWEEN $1 AND $2';
      params.push(from, to);
    }
    query += ' ORDER BY p.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching payments report:', err);
    res.status(500).json({ error: 'Error fetching payments report' });
  }
});

// Customer-specific reports
// Personal Billing History
router.get('/personal-billing', async (req, res) => {
  console.log('Personal billing requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;
    console.log('Personal billing params:', { startDate, endDate, userId });
    
    const query = `
      SELECT 
        b.id as bill_id,
        b.customer_id,
        b.amount_due,
        b.due_date,
        b.billing_date,
        b.status,
        b.consumption,
        b.current_reading,
        b.previous_reading,
        ca.meter_number,
        ca.first_name || ' ' || ca.last_name as customer_name
      FROM bills b
      LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
      WHERE ca.user_id = $1
      ${startDate && endDate ? 'AND b.billing_date BETWEEN $2 AND $3' : ''}
      ORDER BY b.billing_date DESC
      LIMIT 100
    `;
    
    const params = startDate && endDate ? [userId, startDate, endDate] : [userId];
    const result = await pool.query(query, params);
    
    console.log('Personal billing result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching personal billing:', err);
    res.status(500).json({ message: 'Error fetching personal billing history' });
  }
});

// Payment History
router.get('/payment-history', async (req, res) => {
  console.log('Payment history requested by user:', req.user);
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;
    console.log('Payment history params:', { startDate, endDate, userId });
    
    const query = `
      SELECT 
        cb.id as payment_id,
        cb.customer_id,
        cb.amount_paid,
        cb.payment_date,
        cb.payment_method,
        cb.receipt_number,
        ca.first_name || ' ' || ca.last_name as customer_name,
        ca.meter_number,
        'Cashier Payment' as payment_type
      FROM cashier_billing cb
      LEFT JOIN customer_accounts ca ON cb.customer_id = ca.id
      WHERE ca.user_id = $1
      ${startDate && endDate ? 'AND cb.payment_date BETWEEN $2 AND $3' : ''}
      
      UNION ALL
      
      SELECT 
        ps.id as payment_id,
        ps.customer_id,
        ps.amount as amount_paid,
        ps.created_at as payment_date,
        ps.payment_method,
        'Online-' || ps.id as receipt_number,
        ca.first_name || ' ' || ca.last_name as customer_name,
        ca.meter_number,
        'Online Payment' as payment_type
      FROM payment_submissions ps
      LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
      WHERE ca.user_id = $1
      ${startDate && endDate ? 'AND ps.created_at BETWEEN $2 AND $3' : ''}
      
      ORDER BY payment_date DESC
      LIMIT 100
    `;
    
    const params = startDate && endDate ? [userId, startDate, endDate] : [userId];
    const result = await pool.query(query, params);
    
    console.log('Payment history result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ message: 'Error fetching payment history' });
  }
});

// Outstanding Balance
router.get('/outstanding-balance', async (req, res) => {
  console.log('Outstanding balance requested by user:', req.user);
  try {
    const userId = req.user.id;
    console.log('Outstanding balance params:', { userId });
    
    const query = `
      SELECT 
        b.id as bill_id,
        b.customer_id,
        b.amount_due,
        b.due_date,
        b.billing_date,
        b.status,
        b.consumption,
        ca.meter_number,
        ca.first_name || ' ' || ca.last_name as customer_name,
        CASE 
          WHEN b.due_date < CURRENT_DATE THEN 'Overdue'
          WHEN b.due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Due Soon'
          ELSE 'Not Due'
        END as urgency
      FROM bills b
      LEFT JOIN customer_accounts ca ON b.customer_id = ca.id
      WHERE ca.user_id = $1 AND b.status IN ('Pending', 'Overdue')
      ORDER BY b.due_date ASC
    `;
    
    const result = await pool.query(query, [userId]);
    
    console.log('Outstanding balance result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching outstanding balance:', err);
    res.status(500).json({ message: 'Error fetching outstanding balance' });
  }
});

// Proof of Payment
router.get('/proof-of-payment', async (req, res) => {
  console.log('Proof of payment requested by user:', req.user);
  try {
    const userId = req.user.id;
    console.log('Proof of payment params:', { userId });
    
    const query = `
      SELECT 
        ps.id,
        ps.customer_id,
        ps.amount,
        ps.payment_method,
        ps.status,
        ps.created_at as submission_date,
        ps.file_path,
        ca.first_name || ' ' || ca.last_name as customer_name,
        ca.meter_number
      FROM payment_submissions ps
      LEFT JOIN customer_accounts ca ON ps.customer_id = ca.id
      WHERE ca.user_id = $1
      ORDER BY ps.created_at DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query, [userId]);
    
    console.log('Proof of payment result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching proof of payment:', err);
    res.status(500).json({ message: 'Error fetching proof of payment' });
  }
});

module.exports = router; 
