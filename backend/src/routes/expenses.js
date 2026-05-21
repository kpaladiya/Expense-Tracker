import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run, get, all } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/expenses
 * Add expense to group
 */
router.post('/', authenticateToken, async (req, res) => {
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
    const group = await get('SELECT id FROM groups WHERE id = ?', [groupId]);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    const expenseId = uuidv4();
    const date = expenseDate || new Date().toISOString().split('T')[0];

    // Create expense
    await run(
      `INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [expenseId, groupId, req.user.id, parseFloat(amount), note || '', date]
    );

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: {
        id: expenseId,
        groupId,
        userId: req.user.id,
        amount: parseFloat(amount),
        note,
        expenseDate: date
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

    // Get expenses with user info
    const expenses = await all(
      `SELECT e.id, e.group_id, e.user_id, e.amount, e.note, e.expense_date,
              u.name as user_name, u.email as user_email
       FROM expenses e
       JOIN users u ON e.user_id = u.id
       WHERE e.group_id = ?
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: expenses
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
      `SELECT e.id, e.group_id, e.user_id, e.amount, e.note, e.expense_date,
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
      data: expense
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
      'SELECT id, user_id, group_id FROM expenses WHERE id = ?',
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

    // Delete expense
    await run('DELETE FROM expenses WHERE id = ?', [id]);

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
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, note, expenseDate } = req.body;

    // Get expense
    const expense = await get(
      'SELECT id, user_id FROM expenses WHERE id = ?',
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

    // Update expense
    await run(
      `UPDATE expenses 
       SET amount = ?, note = ?, expense_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        amount !== undefined ? parseFloat(amount) : expense.amount,
        note !== undefined ? note : expense.note,
        expenseDate || expense.expenseDate,
        id
      ]
    );

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