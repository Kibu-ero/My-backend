const { processOverdueBills, getPenaltySummary, calculatePenalty } = require('../utils/penaltyCalculator');

/**
 * Process all overdue bills and apply penalties
 * GET /api/penalties/process
 */
exports.processPenalties = async (req, res) => {
  try {
    console.log('🔄 Manual penalty processing requested');
    
    const result = await processOverdueBills();
    
    res.status(200).json({
      success: true,
      message: `Processed ${result.processed} bills, applied penalties to ${result.penaltiesApplied} bills`,
      data: result
    });
    
  } catch (error) {
    console.error('❌ Error processing penalties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process penalties',
      error: error.message
    });
  }
};

/**
 * Get penalty summary for a specific bill
 * GET /api/penalties/bill/:billId
 */
exports.getBillPenalty = async (req, res) => {
  try {
    const { billId } = req.params;
    
    if (!billId) {
      return res.status(400).json({
        success: false,
        message: 'Bill ID is required'
      });
    }
    
    const penaltySummary = await getPenaltySummary(billId);
    
    if (!penaltySummary) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: penaltySummary
    });
    
  } catch (error) {
    console.error('❌ Error getting bill penalty:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get penalty information',
      error: error.message
    });
  }
};

/**
 * Calculate penalty for a specific amount and due date
 * POST /api/penalties/calculate
 */
exports.calculatePenalty = async (req, res) => {
  try {
    const { amount, dueDate, currentDate } = req.body;
    
    if (!amount || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Amount and due date are required'
      });
    }
    
    const penaltyInfo = await calculatePenalty(
      parseFloat(amount), 
      new Date(dueDate), 
      currentDate ? new Date(currentDate) : new Date()
    );
    
    res.status(200).json({
      success: true,
      data: penaltyInfo
    });
    
  } catch (error) {
    console.error('❌ Error calculating penalty:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate penalty',
      error: error.message
    });
  }
};

/**
 * Get all overdue bills with penalty information
 * GET /api/penalties/overdue
 */
exports.getOverdueBills = async (req, res) => {
  try {
    const pool = require('../../db');
    
    const result = await pool.query(`
      SELECT 
        b.bill_id,
        b.customer_id,
        b.amount_due,
        DATE(b.due_date) AS due_date,
        b.penalty,
        b.status,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        c.meter_number,
        GREATEST(0, (CURRENT_DATE - DATE(b.due_date))) AS days_overdue,
        (b.amount_due + COALESCE(b.penalty, 0)) AS total_amount
      FROM billing b
      JOIN customer_accounts c ON b.customer_id = c.id
      WHERE b.status IN ('Unpaid', 'Overdue', 'Pending')
        AND DATE(b.due_date) < CURRENT_DATE
      ORDER BY b.due_date ASC
    `);
    
    // Calculate current penalty for each bill
    const overdueBills = await Promise.all(result.rows.map(async bill => {
      const penaltyInfo = await calculatePenalty(bill.amount_due, bill.due_date);
      return {
        ...bill,
        calculated_penalty: penaltyInfo.penaltyAmount,
        penalty_rate: penaltyInfo.penaltyRate,
        should_update_penalty: Math.abs((bill.penalty || 0) - penaltyInfo.penaltyAmount) > 0.01
      };
    }));
    
    res.status(200).json({
      success: true,
      data: overdueBills,
      count: overdueBills.length
    });
    
  } catch (error) {
    console.error('❌ Error getting overdue bills:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get overdue bills',
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  }
};
