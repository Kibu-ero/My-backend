const pool = require("../../db");

/**
 * Calculate penalty for overdue bills
 * @param {number} baseAmount - The base bill amount
 * @param {Date} dueDate - The due date of the bill
 * @param {Date} currentDate - Current date (defaults to today)
 * @returns {Object} - Penalty details
 */
const calculatePenalty = (baseAmount, dueDate, currentDate = new Date()) => {
  const due = new Date(dueDate);
  const today = new Date(currentDate);
  
  // Calculate days overdue
  const timeDiff = today.getTime() - due.getTime();
  const daysOverdue = Math.ceil(timeDiff / (1000 * 3600 * 24));
  
  if (daysOverdue <= 0) {
    return {
      penaltyAmount: 0,
      daysOverdue: 0,
      penaltyRate: 0,
      hasPenalty: false
    };
  }
  
  // Penalty calculation rules:
  // - 10% penalty after 1 day overdue
  // - Additional 2% for every 30 days (compound)
  let penaltyRate = 0.10; // Base 10% penalty
  
  if (daysOverdue > 30) {
    const additionalPeriods = Math.floor((daysOverdue - 30) / 30);
    penaltyRate += (additionalPeriods * 0.02); // Additional 2% per 30 days
  }
  
  // Cap penalty at 50% of base amount
  penaltyRate = Math.min(penaltyRate, 0.50);
  
  const penaltyAmount = Math.round(baseAmount * penaltyRate * 100) / 100; // Round to 2 decimal places
  
  return {
    penaltyAmount,
    daysOverdue,
    penaltyRate: Math.round(penaltyRate * 100), // Convert to percentage
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
    
    for (const bill of overdueBills.rows) {
      const penaltyInfo = calculatePenalty(bill.amount_due, bill.due_date);
      
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
    const penaltyInfo = calculatePenalty(bill.amount_due, bill.due_date);
    
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
