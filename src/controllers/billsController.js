const db = require('../../db');

const getCustomerBills = async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log('Fetching bills for customer:', customerId);

    const query = [
      'SELECT',
      '  bill_id AS "billId",',
      '  customer_id AS "customerId",',
      '  meter_number,',
      '  previous_reading,',
      '  current_reading,',
      '  consumption,',
      '  COALESCE(amount_due, 0) + COALESCE(penalty, 0) AS "amount",',
      '  penalty,',
      '  due_date,',
      '  status,',
      '  created_at,',
      '  updated_at',
      'FROM billing',
      'WHERE customer_id = $1',
      'ORDER BY due_date ASC'
    ].join('\n');

    console.log('Executing query:\n', query);

    const result = await db.query(query, [customerId]);
    console.log('Query result:', result.rows);

    const formattedBills = result.rows.map(bill => ({
      ...bill,
      dueDate: bill.due_date ? bill.due_date.toISOString().split('T')[0] : null,
      createdAt: bill.created_at ? bill.created_at.toISOString().split('T')[0] : null,
      updatedAt: bill.updated_at ? bill.updated_at.toISOString().split('T')[0] : null,
    }));

    console.log('API about to send bills:', formattedBills);

    res.status(200).json({
      success: true,
      bills: formattedBills.length ? formattedBills : [],
      message: formattedBills.length ? '' : 'No bills found',
    });

  } catch (error) {
    console.error('Error fetching bills:', {
      message: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch bills',
      error: error.message,
    });
  }
};

module.exports = {
  getCustomerBills
};