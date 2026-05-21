import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateSettlement, getSettlementHistory } from '../utils/settlement.js';
import { get } from '../db/index.js';

const router = express.Router();

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
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
    const settlement = await calculateSettlement(groupId);

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

export default router;
