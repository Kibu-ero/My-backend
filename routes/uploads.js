const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { verifyToken, requireRole } = require('../middleware/auth');
const pool = require('../db');
const path = require('path');
const fs = require('fs');

// Upload file route
router.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get the relative path for storage in database
    const relativePath = path.relative(path.join(__dirname, '../uploads'), req.file.path);

    // Store file information in database
    const result = await pool.query(
      'INSERT INTO customer_files (customer_id, file_name, file_path, file_type, file_size) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, req.file.originalname, relativePath, req.file.mimetype, req.file.size]
    );

    res.json({
      message: 'File uploaded successfully',
      file: {
        id: result.rows[0].id,
        name: req.file.originalname,
        path: relativePath,
        type: req.file.mimetype,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Error uploading file' });
  }
});

// Get customer's files
router.get('/files', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM customer_files WHERE customer_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Error fetching files' });
  }
});

// Delete file
router.delete('/files/:fileId', verifyToken, async (req, res) => {
  try {
    // First get the file information
    const fileResult = await pool.query(
      'SELECT * FROM customer_files WHERE id = $1 AND customer_id = $2',
      [req.params.fileId, req.user.id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileResult.rows[0];
    const filePath = path.join(__dirname, '../uploads', file.file_path);

    // Delete from filesystem
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file from filesystem:', err);
    });

    // Delete from database
    await pool.query('DELETE FROM customer_files WHERE id = $1', [req.params.fileId]);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Error deleting file' });
  }
});

// Admin: Get all uploaded files (pending payment proofs only)
router.get('/all', verifyToken, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    console.log('User requesting files:', req.user);
    const result = await pool.query(
      `SELECT cf.*, ca.first_name, ca.last_name, ca.email, ps.bill_id, ps.amount, ps.payment_method, ps.status as payment_status
       FROM customer_files cf
       JOIN customer_accounts ca ON cf.customer_id = ca.id
       LEFT JOIN payment_submissions ps ON cf.customer_id = ps.customer_id AND cf.file_path = ps.payment_proof
       WHERE (ps.status = 'pending' OR ps.status IS NULL)
       ORDER BY cf.created_at DESC`
    );
    console.log('Files fetched:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all files:', error);
    res.status(500).json({ error: 'Error fetching all files' });
  }
});

// Get bill information for a specific file
router.get('/file/:fileId/bill', verifyToken, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const result = await pool.query(
      `SELECT ps.bill_id, ps.amount, ps.payment_method, ps.notes, ps.created_at AS submitted_at, ps.id as submission_id
       FROM customer_files cf
       JOIN payment_submissions ps ON cf.customer_id = ps.customer_id 
         AND cf.file_path = ps.payment_proof
       WHERE cf.id = $1`,
      [fileId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill information not found for this file' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching bill information:', error);
    res.status(500).json({ error: 'Error fetching bill information' });
  }
});

// Update payment submission status (approve/reject)
router.put('/file/:fileId/status', verifyToken, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    
    console.log('Updating payment status for fileId:', fileId, 'status:', status);
    
    // First, let's check if the file exists
    const fileResult = await pool.query(
      'SELECT * FROM customer_files WHERE id = $1',
      [fileId]
    );
    
    if (fileResult.rows.length === 0) {
      console.log('File not found:', fileId);
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = fileResult.rows[0];
    console.log('File found:', file);
    
    // Get the payment submission for this file
    const submissionResult = await pool.query(
      `SELECT ps.id as submission_id, ps.bill_id, ps.customer_id, ps.status as current_status
       FROM payment_submissions ps
       WHERE ps.customer_id = $1 AND ps.payment_proof = $2`,
      [file.customer_id, file.file_path]
    );
    
    console.log('Payment submission query result:', submissionResult.rows);
    
    let submission;
    if (submissionResult.rows.length === 0) {
      console.log('No payment submission found for customer_id:', file.customer_id, 'file_path:', file.file_path);
      console.log('Creating a new payment submission...');
      
      // Create a new payment submission for this file
      const createResult = await pool.query(
        `INSERT INTO payment_submissions (customer_id, bill_id, amount, payment_method, payment_proof, status, reference_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id as submission_id, bill_id, customer_id, status as current_status`,
        [file.customer_id, null, 0, 'Proof Upload', file.file_path, 'pending', null]
      );
      
      submission = createResult.rows[0];
      console.log('Created new payment submission:', submission);
    } else {
      submission = submissionResult.rows[0];
    }
    
    console.log('Payment submission found:', submission);
    
    // Update payment submission status
    const updateResult = await pool.query(
      'UPDATE payment_submissions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, submission.submission_id]
    );
    
    console.log('Payment submission updated:', updateResult.rows[0]);
    
    // If approved, also update the bill status to 'Paid'
    if (status === 'approved' && submission.bill_id) {
      const billUpdateResult = await pool.query(
        'UPDATE billing SET status = $1, updated_at = NOW() WHERE bill_id = $2 RETURNING *',
        ['Paid', submission.bill_id]
      );
      console.log('Bill updated:', billUpdateResult.rows[0]);
    }
    
    res.json({ 
      message: `Payment ${status} successfully`,
      submission_id: submission.submission_id,
      bill_id: submission.bill_id
    });
  } catch (error) {
    console.error('Error updating payment status:', error);
    res.status(500).json({ error: 'Error updating payment status: ' + error.message });
  }
});

// Debug endpoint to check payment submissions structure
router.get('/debug/payment-submissions', verifyToken, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    // Check if payment_submissions table exists and get its structure
    const tableCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_submissions'
      ORDER BY ordinal_position
    `);
    
    // Get sample data
    const sampleData = await pool.query('SELECT * FROM payment_submissions LIMIT 5');
    
    // Get customer_files sample data
    const customerFiles = await pool.query('SELECT * FROM customer_files LIMIT 5');
    
    res.json({
      tableStructure: tableCheck.rows,
      samplePaymentSubmissions: sampleData.rows,
      sampleCustomerFiles: customerFiles.rows
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Debug error: ' + error.message });
  }
});

module.exports = router; 
