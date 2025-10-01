const pool = require('../../db'); // Ensure the correct path to the db module

const getCustomerBills = async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({ success: false, message: "Customer ID is required." });
  }

  try {
    const result = await pool.query("SELECT * FROM bills WHERE customer_id = $1", [customerId]);
    if (!result || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "No bills found for this customer." });
    }
    res.status(200).json({ success: true, bills: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

module.exports = { getCustomerBills };
