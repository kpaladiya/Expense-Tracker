import express from 'express';
import { get } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { listGroupActivity } from '../utils/activity.js';

const router = express.Router();

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
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

    const activity = await listGroupActivity(groupId, {
      month: req.query.month,
      memberId: req.query.memberId,
      type: req.query.type,
      search: req.query.search,
      limit: req.query.limit
    });

    res.json({
      success: true,
      data: activity
    });
  } catch (error) {
    console.error('Get group activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load group activity'
    });
  }
});

export default router;
