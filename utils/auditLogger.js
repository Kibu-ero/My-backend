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
  const text = `
    INSERT INTO audit_logs (user_id, bill_id, action, entity, entity_id, details, ip_address, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;
  const values = [user_id, bill_id, action, entity, entity_id, details ? JSON.stringify(details) : null, ip_address];
  try {
    const result = await pool.query(text, values);
    console.log(`✅ Audit log inserted: ${action}`, { user_id, bill_id, entity, entity_id });
    return result;
  } catch (e) {
    console.error('❌ Audit log insert failed:', e.message);
    console.error('Failed query:', text);
    console.error('Failed values:', values);
    throw e; // Re-throw so caller knows it failed
  }
}

module.exports = { logAudit };
