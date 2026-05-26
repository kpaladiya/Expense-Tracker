import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { logGroupActivity } from '../utils/activity.js';
import { getMembershipPeriodForDate } from '../utils/membership.js';
import { getSettledMonth, getMonthFromDate } from '../utils/settlement.js';

const router = express.Router();

const ENTRY_TYPES = new Set(['expense', 'payment']);
const FREQUENCIES = new Set(['weekly', 'monthly']);

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
}

async function ensureGroupActive(groupId) {
  return get('SELECT id, is_disabled FROM groups WHERE id = ?', [groupId]);
}

function normalizeTemplate(payload) {
  return {
    entryType: payload.entryType,
    title: String(payload.title || '').trim(),
    amount: Number(payload.amount),
    note: String(payload.note || '').trim(),
    paymentMethod: payload.paymentMethod || 'Cash',
    frequency: payload.frequency,
    dayOfWeek: payload.dayOfWeek === '' || payload.dayOfWeek === undefined ? null : Number(payload.dayOfWeek),
    dayOfMonth: payload.dayOfMonth === '' || payload.dayOfMonth === undefined ? null : Number(payload.dayOfMonth),
    isActive: payload.isActive === undefined ? 1 : (payload.isActive ? 1 : 0)
  };
}

function validateTemplate(template) {
  if (!ENTRY_TYPES.has(template.entryType)) {
    return 'Entry type must be expense or payment';
  }

  if (!template.title) {
    return 'Template title is required';
  }

  if (!Number.isFinite(template.amount) || template.amount <= 0) {
    return 'Template amount must be greater than zero';
  }

  if (!FREQUENCIES.has(template.frequency)) {
    return 'Frequency must be weekly or monthly';
  }

  if (template.frequency === 'weekly' && (template.dayOfWeek === null || template.dayOfWeek < 0 || template.dayOfWeek > 6)) {
    return 'Weekly templates require a weekday between 0 and 6';
  }

  if (template.frequency === 'monthly' && (template.dayOfMonth === null || template.dayOfMonth < 1 || template.dayOfMonth > 31)) {
    return 'Monthly templates require a day of month between 1 and 31';
  }

  return null;
}

router.get('/group/:groupId', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const templates = await all(
      `SELECT rt.*, u.name AS user_name
       FROM recurring_templates rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.group_id = ?
       ORDER BY rt.is_active DESC, datetime(rt.updated_at) DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Get recurring templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load recurring templates'
    });
  }
});

router.post('/group/:groupId', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const group = await ensureGroupActive(groupId);
    if (!group || group.is_disabled) {
      return res.status(409).json({
        success: false,
        error: 'This group has been disabled and is now read-only'
      });
    }

    const template = normalizeTemplate(req.body);
    const validationError = validateTemplate(template);

    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError
      });
    }

    const templateId = uuidv4();
    await run(
      `INSERT INTO recurring_templates (
         id, group_id, user_id, entry_type, title, amount, note, payment_method, frequency,
         day_of_week, day_of_month, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        groupId,
        req.user.id,
        template.entryType,
        template.title,
        template.amount,
        template.note,
        template.entryType === 'payment' ? template.paymentMethod : null,
        template.frequency,
        template.dayOfWeek,
        template.dayOfMonth,
        template.isActive
      ]
    );

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'template_created',
      entityType: 'template',
      entityId: templateId,
      title: 'Recurring template created',
      description: `Created recurring ${template.entryType} template "${template.title}"`
    });

    res.status(201).json({
      success: true,
      message: 'Recurring template created successfully',
      data: {
        id: templateId
      }
    });
  } catch (error) {
    console.error('Create recurring template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create recurring template'
    });
  }
});

router.put('/group/:groupId/:templateId', authenticateToken, async (req, res) => {
  try {
    const { groupId, templateId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const templateRow = await get(
      'SELECT * FROM recurring_templates WHERE id = ? AND group_id = ?',
      [templateId, groupId]
    );

    if (!templateRow) {
      return res.status(404).json({
        success: false,
        error: 'Recurring template not found'
      });
    }

    if (templateRow.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can update only your own recurring templates'
      });
    }

    const template = normalizeTemplate({
      ...templateRow,
      ...req.body
    });
    const validationError = validateTemplate(template);

    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError
      });
    }

    await run(
      `UPDATE recurring_templates
       SET entry_type = ?, title = ?, amount = ?, note = ?, payment_method = ?, frequency = ?,
           day_of_week = ?, day_of_month = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        template.entryType,
        template.title,
        template.amount,
        template.note,
        template.entryType === 'payment' ? template.paymentMethod : null,
        template.frequency,
        template.dayOfWeek,
        template.dayOfMonth,
        template.isActive,
        templateId
      ]
    );

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'template_updated',
      entityType: 'template',
      entityId: templateId,
      title: 'Recurring template updated',
      description: `Updated recurring template "${template.title}"`
    });

    res.json({
      success: true,
      message: 'Recurring template updated successfully'
    });
  } catch (error) {
    console.error('Update recurring template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update recurring template'
    });
  }
});

router.delete('/group/:groupId/:templateId', authenticateToken, async (req, res) => {
  try {
    const { groupId, templateId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const template = await get(
      'SELECT id, user_id, title FROM recurring_templates WHERE id = ? AND group_id = ?',
      [templateId, groupId]
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Recurring template not found'
      });
    }

    if (template.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can delete only your own recurring templates'
      });
    }

    await run('DELETE FROM recurring_templates WHERE id = ?', [templateId]);

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'template_deleted',
      entityType: 'template',
      entityId: templateId,
      title: 'Recurring template deleted',
      description: `Deleted recurring template "${template.title}"`
    });

    res.json({
      success: true,
      message: 'Recurring template deleted successfully'
    });
  } catch (error) {
    console.error('Delete recurring template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete recurring template'
    });
  }
});

router.post('/group/:groupId/:templateId/use', authenticateToken, async (req, res) => {
  try {
    const { groupId, templateId } = req.params;
    const { date } = req.body;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const template = await get(
      'SELECT * FROM recurring_templates WHERE id = ? AND group_id = ? AND is_active = 1',
      [templateId, groupId]
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Recurring template not found'
      });
    }

    const entryDate = String(date || new Date().toISOString().slice(0, 10));
    const membershipPeriod = await getMembershipPeriodForDate(groupId, req.user.id, entryDate);

    if (!membershipPeriod) {
      return res.status(400).json({
        success: false,
        error: 'You can use recurring templates only for dates when you were an active member of this group'
      });
    }

    const settledMonth = await getSettledMonth(groupId, getMonthFromDate(entryDate));

    if (settledMonth) {
      return res.status(409).json({
        success: false,
        error: 'This month has already been settled and is closed for changes'
      });
    }

    const recordId = uuidv4();

    if (template.entry_type === 'expense') {
      await run(
        `INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [recordId, groupId, req.user.id, template.amount, template.note || template.title, entryDate]
      );
    } else {
      await run(
        `INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          groupId,
          req.user.id,
          template.amount,
          template.payment_method || 'Cash',
          template.note || template.title,
          entryDate
        ]
      );
    }

    await run(
      `UPDATE recurring_templates
       SET last_used_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [templateId]
    );

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'template_used',
      entityType: template.entry_type,
      entityId: recordId,
      title: 'Recurring template used',
      description: `Created ${template.entry_type} from template "${template.title}"`,
      metadata: {
        templateId
      }
    });

    res.status(201).json({
      success: true,
      message: `${template.entry_type === 'expense' ? 'Expense' : 'Payment'} created from recurring template`,
      data: {
        recordId,
        entryType: template.entry_type
      }
    });
  } catch (error) {
    console.error('Use recurring template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to use recurring template'
    });
  }
});

export default router;
