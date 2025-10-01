const db = require('../../db');
const fs = require('fs');
const path = require('path');

const submitPaymentProof = async (req, res) => {
  try {
    const { billId, customerId, amount, paymentMethod, notes } = req.body;
    const paymentProof = req.file;

    if (!paymentProof) {
      return res.status(400).json({
        success: false,
        message: 'Payment proof file is required',
      });
    }

    console.log('Received payment submission:', { billId, customerId, amount, paymentMethod, notes });

    // Set search_path to public
    await db.query('SET search_path TO public');

    // Print current database name
    const dbNameResult = await db.query('SELECT current_database()');
    console.log('Connected to database:', dbNameResult.rows[0].current_database);

    // Print all bills in billing table
    const allBills = await db.query('SELECT bill_id, customer_id FROM public.billing');
    console.log('All bills in billing table:', allBills.rows);

    // Parse billId and customerId to integers to avoid type mismatch
    const parsedBillId = parseInt(billId);
    const parsedCustomerId = parseInt(customerId);
    console.log('Querying billing with:', { billId, customerId, parsedBillId, parsedCustomerId, typeBillId: typeof parsedBillId, typeCustomerId: typeof parsedCustomerId });

    // Find the bill in the billing table (explicit schema)
    const bill = await db.query(
      `SELECT * FROM public.billing WHERE bill_id = $1`,
      [parsedBillId]
    );
    console.log('Query by bill_id only result:', bill.rows);

    if (bill.rows.length === 0) {
      console.warn('Bill not found for customer:', { billId, customerId });
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    const proofPath = `payment-proofs/${Date.now()}-${paymentProof.originalname}`;
    const destinationPath = path.join('uploads', proofPath);

    try {
      fs.renameSync(paymentProof.path, destinationPath);
    } catch (fileError) {
      console.error('Error saving payment proof file:', fileError);
      return res.status(500).json({
        success: false,
        message: 'Failed to save payment proof file',
      });
    }

    await db.query(
      `INSERT INTO payment_submissions (
        bill_id, customer_id, amount, payment_proof, 
        payment_method, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [parsedBillId, parsedCustomerId, amount, proofPath, paymentMethod, notes]
    );

    console.log('About to insert into customer_files:', {
      customerId,
      file_name: paymentProof.originalname,
      file_path: proofPath,
      file_type: paymentProof.mimetype,
      file_size: paymentProof.size
    });

    await db.query(
      `INSERT INTO customer_files (customer_id, file_name, file_path, file_type, file_size)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        parsedCustomerId,
        paymentProof.originalname,
        proofPath,
        paymentProof.mimetype,
        paymentProof.size
      ]
    );

    // Audit log
    try {
      const { logAudit } = require('../../utils/auditLogger');
      await logAudit({
        user_id: req.user?.id || null,
        action: 'payment_submitted',
        entity: 'payment_submissions',
        entity_id: parsedBillId,
        details: { customer_id: parsedCustomerId, amount, payment_method: paymentMethod },
        ip_address: req.ip
      });
    } catch (_) {}

    console.log('Payment proof submitted successfully:', { billId, customerId });
    res.status(201).json({
      success: true,
      message: 'Payment proof submitted for verification',
    });

  } catch (error) {
    console.error('Payment submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit payment proof',
    });
  }
};

const getCustomerSubmissions = async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log('Fetching submissions for customer:', customerId);

    const result = await db.query(
      `SELECT * FROM payment_submissions 
       WHERE customer_id = $1 
       ORDER BY submitted_at DESC`,
      [customerId]
    );

    console.log('Fetched submissions:', result.rows);
    res.status(200).json({
      success: true,
      submissions: result.rows,
    });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment submissions',
    });
  }
};

module.exports = {
  submitPaymentProof,
  getCustomerSubmissions
};