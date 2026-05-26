import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { calculateSettlement, getSettlementHistory, getSettledMonth, normalizeMonth } from '../utils/settlement.js';
import { get, run } from '../db/index.js';
import { logGroupActivity } from '../utils/activity.js';
import { notifyMonthSettled } from '../utils/notifications.js';

const router = express.Router();

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
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

/**
 * GET /api/settlement/group/:groupId
 * Get settlement calculation for a group
 */
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

    // Calculate settlement
    const settlement = await calculateSettlement(groupId, { excludeSettledMonths: true });

    res.json({
      success: true,
      data: settlement
    });
  } catch (error) {
    console.error('Calculate settlement error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate settlement'
    });
  }
});

router.get('/group/:groupId/history', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const history = await getSettlementHistory(groupId);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Settlement history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load settlement history'
    });
  }
});

router.post('/group/:groupId/settle', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const month = normalizeMonth(req.body?.month);
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    if (!month) {
      return res.status(400).json({
        success: false,
        error: 'A valid month is required'
      });
    }

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

    const existingSettlement = await getSettledMonth(groupId, month);

    if (existingSettlement) {
      return res.status(409).json({
        success: false,
        error: 'This month has already been settled'
      });
    }

    const settlement = await calculateSettlement(groupId, { month });

    if (settlement.totalReceived <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Settle up is available only after money is received for that month'
      });
    }

    await run(
      `INSERT INTO settled_months (id, group_id, month, settled_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), groupId, month, req.user.id]
    );

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'month_settled',
      entityType: 'settlement',
      entityId: month,
      title: 'Month settled',
      description: `Settled ${month}`,
      metadata: {
        month
      }
    });

    const settledMonth = await getSettledMonth(groupId, month);

    let warning;
    try {
      warning = await notifyMonthSettled({
        groupId,
        actorUserId: req.user.id,
        month,
        settlement
      });
    } catch (notificationError) {
      console.error('Settlement notification error:', notificationError);
      warning = 'Month settled, but email notifications could not be sent.';
    }

    res.status(201).json({
      success: true,
      message: 'Month settled successfully',
      ...(warning ? { warning } : {}),
      data: {
        ...settlement,
        isSettled: true,
        settledAt: settledMonth?.settled_at || null,
        settledByUserId: settledMonth?.settled_by_user_id || null,
        settledByName: settledMonth?.settled_by_name || null
      }
    });
  } catch (error) {
    console.error('Settle month error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to settle month'
    });
  }
});

export default router;
