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
  // Try multiple fallback strategies based on what columns exist
  // For JSONB columns, PostgreSQL accepts JSON strings or objects directly
  const detailsValue = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
  
  const attempts = [
    // Attempt 1: Full schema with all columns (details as JSONB, ip_address as VARCHAR)
    {
      name: 'full schema',
      text: `INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, details, ip_address, timestamp) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW()) RETURNING id, timestamp`,
      values: [user_id, bill_id, action, entity, entity_id, detailsValue, ip_address]
    },
    // Attempt 2: Without details, but with bill_id and ip_address
    {
      name: 'without details',
      text: `INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, ip_address, timestamp) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, timestamp`,
      values: [user_id, bill_id, action, entity, entity_id, ip_address]
    },
    // Attempt 3: Without details and ip_address, but with bill_id
    {
      name: 'without details and ip_address',
      text: `INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, timestamp) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, timestamp`,
      values: [user_id, bill_id, action, entity, entity_id]
    },
    // Attempt 4: Without bill_id, details, and ip_address
    {
      name: 'minimal with entity',
      text: `INSERT INTO audit_logs (user_id, action, entity, entity_id, timestamp) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, timestamp`,
      values: [user_id, action, entity, entity_id]
    },
    // Attempt 5: Absolute minimal (just user_id, action, timestamp)
    {
      name: 'absolute minimal',
      text: `INSERT INTO audit_logs (user_id, action, timestamp) VALUES ($1, $2, NOW()) RETURNING id, timestamp`,
      values: [user_id, action]
    }
  ];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const result = await pool.query(attempt.text, attempt.values);
      if (result.rows && result.rows.length > 0) {
        console.log(`✅ Audit log inserted (${attempt.name}): ${action}`, { 
          id: result.rows[0].id,
          user_id, 
          bill_id, 
          entity, 
          entity_id, 
          timestamp: result.rows[0].timestamp || new Date().toISOString(),
          action
        });
        return result;
      } else {
        console.log(`✅ Audit log inserted (${attempt.name}): ${action}`, { 
          user_id, 
          bill_id, 
          entity, 
          entity_id, 
          timestamp: new Date().toISOString(),
          action
        });
        return result;
      }
    } catch (e) {
      // If this is the last attempt, log the error but don't throw
      if (i === attempts.length - 1) {
        console.error(`❌ Audit log insert failed (all ${attempts.length} attempts failed):`, e.message);
        console.error(`Last failed query:`, attempt.text);
        console.error(`Last failed values:`, attempt.values);
        console.error(`Error code:`, e.code);
        // Don't throw - just log the error so login doesn't fail
        return null;
      }
      // Otherwise, try the next fallback
      console.warn(`⚠️ Attempt ${i + 1} (${attempt.name}) failed:`, e.message, `(code: ${e.code})`);
    }
  }
  
  // Should never reach here, but just in case
  return null;
}

module.exports = { logAudit };
