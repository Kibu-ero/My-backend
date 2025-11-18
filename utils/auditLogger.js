const pool = require('../db');

/**
 * Log an audit event with flexible metadata
 * @param {Object} params
 * @param {number|null} params.user_id
 * @param {number|null} params.bill_id - bill ID if related to a bill
 * @param {string} params.action - short verb phrase, e.g., 'bill_created'
 * @param {string} [params.entity] - entity/table name, e.g., 'billing'
 * @param {string|number} [params.entity_id] - primary key of the entity
 * @param {Object} [params.details] - additional structured details
 * @param {string} [params.ip_address]
 */
async function logAudit({ user_id = null, bill_id = null, action, entity = null, entity_id = null, details = null, ip_address = null }) {
  // Try with all columns first (new schema)
  let text = `
    INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, details, ip_address, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;
  let values = [user_id, bill_id, action, entity, entity_id, details ? JSON.stringify(details) : null, ip_address];
  
  try {
    const result = await pool.query(text, values);
    console.log(`✅ Audit log inserted: ${action}`, { user_id, bill_id, entity, entity_id, timestamp: new Date().toISOString() });
    console.log(`✅ Audit log row count:`, result.rowCount);
    return result;
  } catch (e) {
    console.error(`❌ First attempt failed for ${action}:`, e.message);
    // If details column doesn't exist, try without it
    if (e.message && (e.message.includes('column "details"') || e.message.includes('column "bill_id"') || e.code === '42703')) {
      console.warn('⚠️ Some columns not found, trying fallback queries');
      
      // Try without details but with bill_id
      try {
        text = `
          INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, ip_address, timestamp)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `;
        values = [user_id, bill_id, action, entity, entity_id, ip_address];
        const result = await pool.query(text, values);
        console.log(`✅ Audit log inserted (without details): ${action}`, { user_id, bill_id, entity, entity_id, timestamp: new Date().toISOString() });
        console.log(`✅ Audit log row count:`, result.rowCount);
        return result;
      } catch (e2) {
        // Try without both details and bill_id
        if (e2.message && (e2.message.includes('column "bill_id"') || e2.code === '42703')) {
          try {
            text = `
              INSERT INTO audit_logs (user_id, action, entity, entity_id, ip_address, timestamp)
              VALUES ($1, $2, $3, $4, $5, NOW())
            `;
            values = [user_id, action, entity, entity_id, ip_address];
            const result = await pool.query(text, values);
            console.log(`✅ Audit log inserted (minimal): ${action}`, { user_id, entity, entity_id, timestamp: new Date().toISOString() });
            console.log(`✅ Audit log row count:`, result.rowCount);
            return result;
          } catch (fallbackError) {
            console.error('❌ Audit log insert failed (all fallbacks failed):', fallbackError.message);
            throw fallbackError;
          }
        } else {
          console.error('❌ Audit log insert failed (fallback):', e2.message);
          throw e2;
        }
      }
    } else {
      console.error('❌ Audit log insert failed:', e.message);
      console.error('Failed query:', text);
      console.error('Failed values:', values);
      throw e;
    }
  }
}

module.exports = { logAudit };
