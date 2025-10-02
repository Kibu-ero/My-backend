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
      'ORDER BY created_at DESC'
    ].join('\n');

    console.log('Executing query:\n', query);

    const result = await db.query(query, [customerId]);
    console.log('Query result:', result.rows);

    const formattedBills = result.rows.map(bill => {
      // Format dates in local time to avoid UTC shifting
      const formatDate = (date) => {
        if (!date) return null;
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      return {
        ...bill,
        dueDate: formatDate(bill.due_date),
        createdAt: formatDate(bill.created_at),
        updatedAt: formatDate(bill.updated_at),
      };
    });

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
