import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run, get, all } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const VALID_PAYMENT_METHODS = ['Cash', 'PayPal'];

/**
 * POST /api/payments
 * Record customer payment received
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { groupId, amount, paymentMethod, customerNote, paymentDate } = req.body;

    // Validate input
    if (!groupId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'Group ID, amount, and payment method are required'
      });
    }

    // Validate payment method
    if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: `Payment method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`
      });
    }

    // Check if user is member of group
    const member = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.id]
    );

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    // Validate group exists
    const group = await get('SELECT id FROM groups WHERE id = ?', [groupId]);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    const paymentId = uuidv4();
    const date = paymentDate || new Date().toISOString().split('T')[0];

    // Create payment
    await run(
      `INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId,
        groupId,
        req.user.id,
        parseFloat(amount),
        paymentMethod,
        customerNote || '',
        date
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        id: paymentId,
        groupId,
        userId: req.user.id,
        amount: parseFloat(amount),
        paymentMethod,
        customerNote,
        paymentDate: date
      }
    });
  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record payment'
    });
  }
});

/**
 * GET /api/payments/group/:groupId
 * Get all payments for a group
 */
router.get('/group/:groupId', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if user is member of group
    const member = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.id]
    );

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    // Get payments with user info
    const payments = await all(
      `SELECT p.id, p.group_id, p.user_id, p.amount, p.payment_method, 
              p.customer_note, p.payment_date,
              u.name as user_name, u.email as user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE p.group_id = ?
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payments'
    });
  }
});

/**
 * GET /api/payments/:id
 * Get single payment
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await get(
      `SELECT p.id, p.group_id, p.user_id, p.amount, p.payment_method,
              p.customer_note, p.payment_date,
              u.name as user_name, u.email as user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    // Check if user is member of group
    const member = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [payment.group_id, req.user.id]
    );

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment'
    });
  }
});

/**
 * DELETE /api/payments/:id
 * Delete payment (only by recorder)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get payment
    const payment = await get(
      'SELECT id, user_id, group_id FROM payments WHERE id = ?',
      [id]
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    // Check if user is the one who recorded the payment
    if (payment.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own payments'
      });
    }

    // Delete payment
    await run('DELETE FROM payments WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete payment'
    });
  }
});

/**
 * PUT /api/payments/:id
 * Update payment (only by recorder)
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, customerNote, paymentDate } = req.body;

    // Get payment
    const payment = await get(
      'SELECT id, user_id FROM payments WHERE id = ?',
      [id]
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    // Check if user is the one who recorded the payment
    if (payment.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own payments'
      });
    }

    // Validate payment method if provided
    if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: `Payment method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`
      });
    }

    // Update payment
    await run(
      `UPDATE payments 
       SET amount = ?, payment_method = ?, customer_note = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        amount !== undefined ? parseFloat(amount) : payment.amount,
        paymentMethod || payment.paymentMethod,
        customerNote !== undefined ? customerNote : payment.customerNote,
        paymentDate || payment.paymentDate,
        id
      ]
    );

    res.json({
      success: true,
      message: 'Payment updated successfully'
    });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment'
    });
  }
});

export default router;