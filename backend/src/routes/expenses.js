import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run, get, all } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { logGroupActivity } from '../utils/activity.js';
import { getMembershipPeriodForDate } from '../utils/membership.js';
import { notifyExpenseAdded } from '../utils/notifications.js';
import { getMonthFromDate, getSettledMonth } from '../utils/settlement.js';
import { createUndoAction } from '../utils/undo.js';
import { attachmentUpload, buildAttachmentColumns, buildAttachmentResponse, removeStoredAttachment } from '../utils/uploads.js';

const router = express.Router();

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

function serializeExpense(req, expense) {
  return {
    ...expense,
    attachment: buildAttachmentResponse(req, expense)
  };
}

/**
 * POST /api/expenses
 * Add expense to group
 */
router.post('/', authenticateToken, attachmentUpload.single('attachment'), async (req, res) => {
  try {
    const { groupId, amount, note, expenseDate } = req.body;

    // Validate input
    if (!groupId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Group ID and amount are required'
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

    const expenseId = uuidv4();
    const date = expenseDate || new Date().toISOString().split('T')[0];
    const membershipPeriod = await getMembershipPeriodForDate(groupId, req.user.id, date);

    if (!membershipPeriod) {
      return res.status(400).json({
        success: false,
        error: 'You can add expenses only for dates when you were an active member of this group'
      });
    }

    const settledMonth = await getSettledMonth(groupId, getMonthFromDate(date));

    if (settledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const attachment = buildAttachmentColumns(req.file);

    // Create expense
    await run(
      `INSERT INTO expenses (
         id, group_id, user_id, amount, note, attachment_name, attachment_path, attachment_mime_type, attachment_size, expense_date
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expenseId,
        groupId,
        req.user.id,
        parseFloat(amount),
        note || '',
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
      actionType: 'expense_created',
      entityType: 'expense',
      entityId: expenseId,
      payload: {
        mode: 'delete-expense',
        record: {
          id: expenseId,
          attachment_path: attachment.attachmentPath
        }
      }
    });

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'expense_created',
      entityType: 'expense',
      entityId: expenseId,
      title: 'Expense added',
      description: `Added ${parseFloat(amount).toFixed(2)} expense${note ? ` for ${note}` : ''}`,
      metadata: {
        amount: parseFloat(amount),
        note: note || '',
        expenseDate: date
      }
    });

    let warning;
    try {
      warning = await notifyExpenseAdded({
       groupId,
       actorUserId: req.user.id,
       amount: parseFloat(amount),
       note,
       expenseDate: date
      });
    } catch (notificationError) {
      console.error('Expense notification error:', notificationError);
      warning = 'Expense saved, but email notifications could not be sent.';
    }

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      ...(warning ? { warning } : {}),
      data: {
       id: expenseId,
       groupId,
        userId: req.user.id,
        amount: parseFloat(amount),
        note,
        expenseDate: date,
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
    console.error('Add expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add expense'
    });
  }
});

/**
 * GET /api/expenses/group/:groupId
 * Get all expenses for a group
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

    const conditions = ['e.group_id = ?'];
    const params = [groupId];

    if (req.query.month) {
      conditions.push('substr(e.expense_date, 1, 7) = ?');
      params.push(req.query.month);
    }

    if (req.query.memberId) {
      conditions.push('e.user_id = ?');
      params.push(req.query.memberId);
    }

    if (req.query.search?.trim()) {
      conditions.push('LOWER(COALESCE(e.note, \'\')) LIKE ?');
      params.push(`%${req.query.search.trim().toLowerCase()}%`);
    }

    // Get expenses with user info
    const expenses = await all(
      `SELECT e.id, e.group_id, e.user_id, e.amount, e.note,
             e.attachment_name, e.attachment_path, e.attachment_mime_type, e.attachment_size,
             e.expense_date,
             u.name as user_name, u.email as user_email
       FROM expenses e
       JOIN users u ON e.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: expenses.map((expense) => serializeExpense(req, expense))
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get expenses'
    });
  }
});

/**
 * GET /api/expenses/:id
 * Get single expense
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await get(
      `SELECT e.id, e.group_id, e.user_id, e.amount, e.note,
              e.attachment_name, e.attachment_path, e.attachment_mime_type, e.attachment_size,
              e.expense_date,
              u.name as user_name, u.email as user_email
       FROM expenses e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = ?`,
      [id]
    );

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Check if user is member of group
    const member = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [expense.group_id, req.user.id]
    );

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    res.json({
      success: true,
      data: serializeExpense(req, expense)
    });
  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get expense'
    });
  }
});

/**
 * DELETE /api/expenses/:id
 * Delete expense (only by owner)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get expense
    const expense = await get(
      `SELECT id, group_id, user_id, amount, note, attachment_name, attachment_path, attachment_mime_type,
              attachment_size, expense_date, created_at, updated_at
       FROM expenses
       WHERE id = ?`,
      [id]
    );

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Check if user is the one who created the expense
    if (expense.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own expenses'
      });
    }

    const activeMembership = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [expense.group_id, req.user.id]
    );

    if (!activeMembership) {
      return res.status(403).json({
        success: false,
        error: 'You are no longer an active member of this group'
      });
    }

    const group = await getGroupState(expense.group_id);

    if (group?.is_disabled) {
      return res.status(409).json(buildDisabledGroupError());
    }

    const settledMonth = await getSettledMonth(expense.group_id, getMonthFromDate(expense.expense_date));

    if (settledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    await createUndoAction({
      userId: req.user.id,
      groupId: expense.group_id,
      actionType: 'expense_deleted',
      entityType: 'expense',
      entityId: id,
      payload: {
        mode: 'restore-expense',
        record: expense
      }
    });

    // Delete expense
    await run('DELETE FROM expenses WHERE id = ?', [id]);
    removeStoredAttachment(expense.attachment_path);

    await logGroupActivity({
      groupId: expense.group_id,
      userId: req.user.id,
      activityType: 'expense_deleted',
      entityType: 'expense',
      entityId: id,
      title: 'Expense deleted',
      description: 'Deleted an expense entry'
    });

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete expense'
    });
  }
});

/**
 * PUT /api/expenses/:id
 * Update expense (only by owner)
 */
router.put('/:id', authenticateToken, attachmentUpload.single('attachment'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, note, expenseDate, removeAttachment } = req.body;

    // Get expense
    const expense = await get(
      `SELECT id, group_id, user_id, amount, note,
              attachment_name, attachment_path, attachment_mime_type, attachment_size,
              expense_date
       FROM expenses
       WHERE id = ?`,
      [id]
    );

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Check if user is the one who created the expense
    if (expense.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own expenses'
      });
    }

    const activeMembership = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [expense.group_id, req.user.id]
    );

    if (!activeMembership) {
      return res.status(403).json({
        success: false,
        error: 'You are no longer an active member of this group'
      });
    }

    const group = await getGroupState(expense.group_id);

    if (group?.is_disabled) {
      return res.status(409).json(buildDisabledGroupError());
    }

    const nextExpenseDate = expenseDate || expense.expense_date;
    const membershipPeriod = await getMembershipPeriodForDate(expense.group_id, req.user.id, nextExpenseDate);

    if (!membershipPeriod) {
      return res.status(400).json({
        success: false,
        error: 'You can update expenses only for dates when you were an active member of this group'
      });
    }
    const currentSettledMonth = await getSettledMonth(expense.group_id, getMonthFromDate(expense.expense_date));

    if (currentSettledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const nextSettledMonth = await getSettledMonth(expense.group_id, getMonthFromDate(nextExpenseDate));

    if (nextSettledMonth) {
      return res.status(409).json(buildClosedMonthError());
    }

    const nextAttachment = req.file
      ? buildAttachmentColumns(req.file)
      : toBoolean(removeAttachment)
       ? buildAttachmentColumns(null)
       : {
           attachmentName: expense.attachment_name,
           attachmentPath: expense.attachment_path,
           attachmentMimeType: expense.attachment_mime_type,
           attachmentSize: expense.attachment_size
         };

    await createUndoAction({
         userId: req.user.id,
         groupId: expense.group_id,
         actionType: 'expense_updated',
         entityType: 'expense',
         entityId: id,
         payload: {
           mode: 'revert-expense',
           previous: expense
         }
    });

    // Update expense
    await run(
      `UPDATE expenses
       SET amount = ?, note = ?, attachment_name = ?, attachment_path = ?, attachment_mime_type = ?,
          attachment_size = ?, expense_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
       amount !== undefined ? parseFloat(amount) : expense.amount,
       note !== undefined ? note : expense.note,
       nextAttachment.attachmentName,
       nextAttachment.attachmentPath,
       nextAttachment.attachmentMimeType,
       nextAttachment.attachmentSize,
       nextExpenseDate,
       id
      ]
    );

    if (req.file || toBoolean(removeAttachment)) {
      removeStoredAttachment(expense.attachment_path);
    }

    await logGroupActivity({
      groupId: expense.group_id,
      userId: req.user.id,
      activityType: 'expense_updated',
      entityType: 'expense',
      entityId: id,
      title: 'Expense updated',
      description: 'Updated an expense entry',
      metadata: {
       amount: amount !== undefined ? parseFloat(amount) : expense.amount,
       expenseDate: nextExpenseDate
      }
    });

    res.json({
      success: true,
      message: 'Expense updated successfully'
    });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update expense'
    });
  }
});

export default router;