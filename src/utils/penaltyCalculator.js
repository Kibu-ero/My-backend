const pool = require("../../db");

/**
 * Get system settings for penalty calculation
 */
async function getPenaltySettings() {
  try {
    const result = await pool.query(`
      SELECT setting_key, setting_value 
      FROM system_settings 
      WHERE setting_key IN ('late_payment_fee', 'due_date_grace_period')
    `);
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    return {
      latePaymentFee: settings.late_payment_fee ? parseFloat(settings.late_payment_fee) : null,
      gracePeriod: settings.due_date_grace_period ? parseInt(settings.due_date_grace_period) : 0
    };
  } catch (error) {
    console.error('Error fetching penalty settings:', error);
    return { latePaymentFee: null, gracePeriod: 0 };
  }
}

/**
 * Calculate penalty for overdue bills
 * @param {number} baseAmount - The base bill amount
 * @param {Date} dueDate - The due date of the bill
 * @param {Date} currentDate - Current date (defaults to today)
 * @param {Object} settings - Optional settings override {latePaymentFee, gracePeriod}
 * @returns {Object} - Penalty details
 */
const calculatePenalty = async (baseAmount, dueDate, currentDate = new Date(), settings = null) => {
  const due = new Date(dueDate);
  const today = new Date(currentDate);
  
  // Get settings if not provided
  if (!settings) {
    settings = await getPenaltySettings();
  }
  
  // Calculate days overdue
  const timeDiff = today.getTime() - due.getTime();
  let daysOverdue = Math.ceil(timeDiff / (1000 * 3600 * 24));
  
  // Apply grace period - no penalty during grace period
  if (settings.gracePeriod > 0 && daysOverdue > 0 && daysOverdue <= settings.gracePeriod) {
    return {
      penaltyAmount: 0,
      daysOverdue: daysOverdue,
      penaltyRate: 0,
      hasPenalty: false,
      inGracePeriod: true
    };
  }
  
  // Adjust days overdue by grace period for calculation
  if (settings.gracePeriod > 0 && daysOverdue > settings.gracePeriod) {
    daysOverdue = daysOverdue - settings.gracePeriod;
  }
  
  if (daysOverdue <= 0) {
    return {
      penaltyAmount: 0,
      daysOverdue: 0,
      penaltyRate: 0,
      hasPenalty: false
    };
  }
  
  let penaltyAmount = 0;
  
  // Use late_payment_fee from settings if available (flat fee)
  if (settings.latePaymentFee !== null && settings.latePaymentFee > 0) {
    penaltyAmount = settings.latePaymentFee;
  } else {
    // Fallback to percentage-based calculation
    // - 10% penalty after grace period
    // - Additional 2% for every 30 days (compound)
    let penaltyRate = 0.10; // Base 10% penalty
    
    if (daysOverdue > 30) {
      const additionalPeriods = Math.floor((daysOverdue - 30) / 30);
      penaltyRate += (additionalPeriods * 0.02); // Additional 2% per 30 days
    }
    
    // Cap penalty at 50% of base amount
    penaltyRate = Math.min(penaltyRate, 0.50);
    penaltyAmount = baseAmount * penaltyRate;
  }
  
  penaltyAmount = Math.round(penaltyAmount * 100) / 100; // Round to 2 decimal places
  
  return {
    penaltyAmount,
    daysOverdue: daysOverdue + (settings.gracePeriod || 0),
    penaltyRate: settings.latePaymentFee !== null ? 0 : Math.round((penaltyAmount / baseAmount) * 100),
    hasPenalty: penaltyAmount > 0
  };
};

/**
 * Process overdue bills and apply penalties
 */
const processOverdueBills = async () => {
  try {
    console.log('🔄 Processing overdue bills...');
    
    // Get all unpaid bills that are past due date
    const overdueBills = await pool.query(`
      SELECT 
        bill_id,
        customer_id,
        amount_due,
        due_date,
        status,
        penalty,
        created_at
      FROM billing 
      WHERE status IN ('Unpaid', 'Pending')
      AND due_date < CURRENT_DATE
      ORDER BY due_date ASC
    `);
    
    console.log(`Found ${overdueBills.rows.length} overdue bills`);
    
    let processedCount = 0;
    let penaltyAppliedCount = 0;
    
    // Get penalty settings once for all bills
    const penaltySettings = await getPenaltySettings();
    
    for (const bill of overdueBills.rows) {
      const penaltyInfo = await calculatePenalty(bill.amount_due, bill.due_date, new Date(), penaltySettings);
      
      // Only update if penalty should be applied and it's different from current penalty
      if (penaltyInfo.hasPenalty && bill.penalty !== penaltyInfo.penaltyAmount) {
        await pool.query(`
          UPDATE billing 
          SET 
            penalty = $1,
            status = CASE 
              WHEN status = 'Unpaid' THEN 'Overdue'
              ELSE status 
            END,
            updated_at = CURRENT_TIMESTAMP
          WHERE bill_id = $2
        `, [penaltyInfo.penaltyAmount, bill.bill_id]);
        
        penaltyAppliedCount++;
        console.log(`✅ Applied penalty of ₱${penaltyInfo.penaltyAmount} to bill ${bill.bill_id} (${penaltyInfo.daysOverdue} days overdue)`);
      }
      
      // Update status to Overdue if still Unpaid
      if (bill.status === 'Unpaid' && penaltyInfo.daysOverdue > 0) {
        await pool.query(`
          UPDATE billing 
          SET status = 'Overdue'
          WHERE bill_id = $1 AND status = 'Unpaid'
        `, [bill.bill_id]);
      }
      
      processedCount++;
    }
    
    console.log(`✅ Processed ${processedCount} bills, applied penalties to ${penaltyAppliedCount} bills`);
    
    return {
      success: true,
      processed: processedCount,
      penaltiesApplied: penaltyAppliedCount
    };
    
  } catch (error) {
    console.error('❌ Error processing overdue bills:', error);
    throw error;
  }
};

/**
 * Get penalty summary for a specific bill
 */
const getPenaltySummary = async (billId) => {
  try {
    const result = await pool.query(`
      SELECT 
        bill_id,
        amount_due,
        due_date,
        penalty,
        status,
        CURRENT_DATE - due_date as days_overdue
      FROM billing 
      WHERE bill_id = $1
    `, [billId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const bill = result.rows[0];
    const penaltyInfo = await calculatePenalty(bill.amount_due, bill.due_date);
    
    return {
      billId: bill.bill_id,
      baseAmount: bill.amount_due,
      currentPenalty: bill.penalty || 0,
      calculatedPenalty: penaltyInfo.penaltyAmount,
      daysOverdue: penaltyInfo.daysOverdue,
      penaltyRate: penaltyInfo.penaltyRate,
      status: bill.status,
      totalAmount: bill.amount_due + (bill.penalty || 0)
    };
    
  } catch (error) {
    console.error('❌ Error getting penalty summary:', error);
    throw error;
  }
};

module.exports = {
  calculatePenalty,
  processOverdueBills,
  getPenaltySummary
};
