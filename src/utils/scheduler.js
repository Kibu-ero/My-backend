const cron = require('node-cron');
const { processOverdueBills } = require('./penaltyCalculator');
// const pool = require('../../db');
// const { sendSms } = require('./sms');

/**
 * Schedule automatic penalty processing
 * Runs daily at 2:00 AM to process overdue bills
 */
const schedulePenaltyProcessing = () => {
  console.log('📅 Scheduling automatic penalty processing...');
  
  // Run daily at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('🕐 Running scheduled penalty processing...');
    try {
      const result = await processOverdueBills();
      console.log(`✅ Scheduled penalty processing completed: ${result.processed} bills processed, ${result.penaltiesApplied} penalties applied`);
    } catch (error) {
      console.error('❌ Scheduled penalty processing failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Manila"
  });
  
  console.log('✅ Penalty processing scheduled for 2:00 AM daily');
};

/**
 * Manual trigger for testing (runs immediately)
 */
const runPenaltyProcessingNow = async () => {
  console.log('🔄 Running penalty processing immediately...');
  try {
    const result = await processOverdueBills();
    console.log(`✅ Immediate penalty processing completed: ${result.processed} bills processed, ${result.penaltiesApplied} penalties applied`);
    return result;
  } catch (error) {
    console.error('❌ Immediate penalty processing failed:', error);
    throw error;
  }
};

module.exports = {
  schedulePenaltyProcessing,
  runPenaltyProcessingNow
};
