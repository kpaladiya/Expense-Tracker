import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run, get, all } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { logGroupActivity } from '../utils/activity.js';
import { getMembershipPeriodForDate } from '../utils/membership.js';
import { notifyPaymentAdded } from '../utils/notifications.js';
import { getMonthFromDate, getSettledMonth } from '../utils/settlement.js';
import { createUndoAction } from '../utils/undo.js';
import { attachmentUpload, buildAttachmentColumns, buildAttachmentResponse, removeStoredAttachment } from '../utils/uploads.js';

const router = express.Router();

const VALID_PAYMENT_METHODS = ['Cash', 'PayPal'];

function buildClosedMonthError() {
  return {
    success: false,
    error: 'This month has already been settled and is closed for changes'
  };
}

function buildDisabledGroupError() {
  return {
    success: false,
    error: 'This group has been disabled and is now read-only'
  };
}

async function getGroupState(groupId) {
  return get('SELECT id, is_disabled FROM groups WHERE id = ?', [groupId]);
}

function toBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function serializePayment(req, payment) {
  return {
    ...payment,
    attachment: buildAttachmentResponse(req, payment)
  };
}

/**
 * POST /api/payments
 * Record customer payment received
 */
router.post('/', authenticateToken, attachmentUpload.single('attachment'), async (req, res) => {
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
    const group = await getGroupState(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    if (group.is_disabled) {
      return res.status(409).json(buildDisabledGroupError());
    }

    const paymentId = uuidv4();
    const date = paymentDate || new Date().toISOString().split('T')[0];
    const membershipPeriod = await getMembershipPeriodForDate(groupId, req.user.id, date);

    if (!membershipPeriod) {
      return res.status(400).json({
        success: false,
        error: 'You can add payments only for dates when you were an active member of this group'
      });
    }

    const settledMonth = await getSettledMonth(groupId, getMonthFromDate(date));

    if (settledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const attachment = buildAttachmentColumns(req.file);

    // Create payment
    await run(
      `INSERT INTO payments (
         id, group_id, user_id, amount, payment_method, customer_note,
         attachment_name, attachment_path, attachment_mime_type, attachment_size, payment_date
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId,
        groupId,
        req.user.id,
        parseFloat(amount),
        paymentMethod,
        customerNote || '',
        attachment.attachmentName,
        attachment.attachmentPath,
        attachment.attachmentMimeType,
        attachment.attachmentSize,
        date
      ]
    );

    await createUndoAction({
      userId: req.user.id,
      groupId,
      actionType: 'payment_created',
      entityType: 'payment',
      entityId: paymentId,
      payload: {
        mode: 'delete-payment',
        record: {
          id: paymentId,
          attachment_path: attachment.attachmentPath
        }
      }
    });

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'payment_created',
      entityType: 'payment',
      entityId: paymentId,
      title: 'Payment recorded',
      description: `Recorded ${parseFloat(amount).toFixed(2)} payment via ${paymentMethod}`,
      metadata: {
        amount: parseFloat(amount),
        paymentMethod,
        paymentDate: date
      }
    });

    let warning;
    try {
      warning = await notifyPaymentAdded({
        groupId,
        actorUserId: req.user.id,
        amount: parseFloat(amount),
        paymentMethod,
        customerNote,
        paymentDate: date
      });
    } catch (notificationError) {
      console.error('Payment notification error:', notificationError);
      warning = 'Payment saved, but email notifications could not be sent.';
    }

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      ...(warning ? { warning } : {}),
      data: {
        id: paymentId,
        groupId,
        userId: req.user.id,
        amount: parseFloat(amount),
        paymentMethod,
        customerNote,
        paymentDate: date,
        attachment: attachment.attachmentPath
          ? {
              name: attachment.attachmentName,
              path: attachment.attachmentPath,
              mimeType: attachment.attachmentMimeType,
              size: attachment.attachmentSize,
              url: `${req.protocol}://${req.get('host')}${attachment.attachmentPath}`
            }
          : null
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

    const conditions = ['p.group_id = ?'];
    const params = [groupId];

    if (req.query.month) {
      conditions.push('substr(p.payment_date, 1, 7) = ?');
      params.push(req.query.month);
    }

    if (req.query.memberId) {
      conditions.push('p.user_id = ?');
      params.push(req.query.memberId);
    }

    if (req.query.search?.trim()) {
      conditions.push('LOWER(COALESCE(p.customer_note, \'\')) LIKE ?');
      params.push(`%${req.query.search.trim().toLowerCase()}%`);
    }

    // Get payments with user info
    const payments = await all(
      `SELECT p.id, p.group_id, p.user_id, p.amount, p.payment_method, 
             p.customer_note, p.attachment_name, p.attachment_path, p.attachment_mime_type, p.attachment_size,
             p.payment_date,
             u.name as user_name, u.email as user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: payments.map((payment) => serializePayment(req, payment))
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
              p.customer_note, p.attachment_name, p.attachment_path, p.attachment_mime_type, p.attachment_size,
              p.payment_date,
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
      data: serializePayment(req, payment)
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
      `SELECT id, group_id, user_id, amount, payment_method, customer_note, attachment_name, attachment_path,
              attachment_mime_type, attachment_size, payment_date, created_at, updated_at
       FROM payments
       WHERE id = ?`,
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

    const activeMembership = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [payment.group_id, req.user.id]
    );

    if (!activeMembership) {
      return res.status(403).json({
        success: false,
        error: 'You are no longer an active member of this group'
      });
    }

    const group = await getGroupState(payment.group_id);

    if (group?.is_disabled) {
      return res.status(409).json(buildDisabledGroupError());
    }

    const settledMonth = await getSettledMonth(payment.group_id, getMonthFromDate(payment.payment_date));

    if (settledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    await createUndoAction({
      userId: req.user.id,
      groupId: payment.group_id,
      actionType: 'payment_deleted',
      entityType: 'payment',
      entityId: id,
      payload: {
        mode: 'restore-payment',
        record: payment
      }
    });

    // Delete payment
    await run('DELETE FROM payments WHERE id = ?', [id]);
    removeStoredAttachment(payment.attachment_path);

    await logGroupActivity({
      groupId: payment.group_id,
      userId: req.user.id,
      activityType: 'payment_deleted',
      entityType: 'payment',
      entityId: id,
      title: 'Payment deleted',
      description: 'Deleted a payment entry'
    });

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
router.put('/:id', authenticateToken, attachmentUpload.single('attachment'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, customerNote, paymentDate, removeAttachment } = req.body;

    // Get payment
    const payment = await get(
      `SELECT id, group_id, user_id, amount, payment_method, customer_note,
             attachment_name, attachment_path, attachment_mime_type, attachment_size, payment_date
       FROM payments
       WHERE id = ?`,
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

    const activeMembership = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [payment.group_id, req.user.id]
    );

    if (!activeMembership) {
      return res.status(403).json({
        success: false,
        error: 'You are no longer an active member of this group'
      });
    }

    const group = await getGroupState(payment.group_id);

    if (group?.is_disabled) {
      return res.status(409).json(buildDisabledGroupError());
    }

    // Validate payment method if provided
    if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: `Payment method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`
      });
    }

    const nextPaymentDate = paymentDate || payment.payment_date;
    const membershipPeriod = await getMembershipPeriodForDate(payment.group_id, req.user.id, nextPaymentDate);

    if (!membershipPeriod) {
      return res.status(400).json({
        success: false,
        error: 'You can update payments only for dates when you were an active member of this group'
      });
    }
    const currentSettledMonth = await getSettledMonth(payment.group_id, getMonthFromDate(payment.payment_date));

    if (currentSettledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const nextSettledMonth = await getSettledMonth(payment.group_id, getMonthFromDate(nextPaymentDate));

    if (nextSettledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const nextAttachment = req.file
      ? buildAttachmentColumns(req.file)
      : toBoolean(removeAttachment)
       ? buildAttachmentColumns(null)
       : {
           attachmentName: payment.attachment_name,
           attachmentPath: payment.attachment_path,
           attachmentMimeType: payment.attachment_mime_type,
           attachmentSize: payment.attachment_size
         };

    await createUndoAction({
         userId: req.user.id,
         groupId: payment.group_id,
         actionType: 'payment_updated',
         entityType: 'payment',
         entityId: id,
         payload: {
           mode: 'revert-payment',
           previous: payment
         }
    });

    // Update payment
    await run(
      `UPDATE payments
       SET amount = ?, payment_method = ?, customer_note = ?, attachment_name = ?, attachment_path = ?,
          attachment_mime_type = ?, attachment_size = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
       amount !== undefined ? parseFloat(amount) : payment.amount,
       paymentMethod || payment.payment_method,
       customerNote !== undefined ? customerNote : payment.customer_note,
       nextAttachment.attachmentName,
       nextAttachment.attachmentPath,
       nextAttachment.attachmentMimeType,
       nextAttachment.attachmentSize,
       nextPaymentDate,
       id
      ]
    );

    if (req.file || toBoolean(removeAttachment)) {
      removeStoredAttachment(payment.attachment_path);
    }

    await logGroupActivity({
      groupId: payment.group_id,
      userId: req.user.id,
      activityType: 'payment_updated',
      entityType: 'payment',
      entityId: id,
      title: 'Payment updated',
      description: 'Updated a payment entry',
      metadata: {
       amount: amount !== undefined ? parseFloat(amount) : payment.amount,
       paymentMethod: paymentMethod || payment.payment_method,
       paymentDate: nextPaymentDate
      }
    });

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