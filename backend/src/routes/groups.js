import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const REQUEST_STATUS = {
  pendingUser: 'pending_user',
  pendingAdmin: 'pending_admin',
  approved: 'approved',
  declinedByUser: 'declined_by_user',
  rejectedByAdmin: 'rejected_by_admin'
};

async function getGroupById(groupId) {
  return get(
    `SELECT g.id, g.name, g.description, g.admin_id, u.name as admin_name
     FROM groups g
     LEFT JOIN users u ON g.admin_id = u.id
     WHERE g.id = ?`,
    [groupId]
  );
}

async function ensureAdmin(groupId, userId) {
  const group = await getGroupById(groupId);

  if (!group) {
    return {
      error: {
        status: 404,
        body: {
          success: false,
          error: 'Group not found'
        }
      }
    };
  }

  if (group.admin_id !== userId) {
    return {
      error: {
        status: 403,
        body: {
          success: false,
          error: 'Only group admin can manage this action'
        }
      }
    };
  }

  return { group };
}

async function getMembers(groupId) {
  return all(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN group_members gm ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY u.name`,
    [groupId]
  );
}

async function getActiveJoinRequest(groupId, userId) {
  return get(
    `SELECT id, status
     FROM group_join_requests
     WHERE group_id = ?
       AND invited_user_id = ?
       AND status IN (?, ?)
     ORDER BY created_at DESC
     LIMIT 1`,
    [groupId, userId, REQUEST_STATUS.pendingUser, REQUEST_STATUS.pendingAdmin]
  );
}

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Group name is required'
      });
    }

    const groupId = uuidv4();

    await run(
      `INSERT INTO groups (id, name, description, admin_id)
       VALUES (?, ?, ?, ?)`,
      [groupId, name, description || '', req.user.id]
    );

    await run(
      `INSERT INTO group_members (id, group_id, user_id)
       VALUES (?, ?, ?)`,
      [uuidv4(), groupId, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: {
        id: groupId,
        name,
        description,
        adminId: req.user.id
      }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create group'
    });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const groups = await all(
      `SELECT g.id, g.name, g.description, g.admin_id,
              u.name as admin_name,
              COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.admin_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id IN (
         SELECT group_id FROM group_members WHERE user_id = ?
       )
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get groups'
    });
  }
});

router.get('/invitations/received', authenticateToken, async (req, res) => {
  try {
    const invitations = await all(
      `SELECT r.id, r.group_id, r.status, r.created_at, r.responded_at,
              g.name as group_name,
              inviter.name as invited_by_name,
              inviter.email as invited_by_email
       FROM group_join_requests r
       JOIN groups g ON r.group_id = g.id
       JOIN users inviter ON r.invited_by_user_id = inviter.id
       WHERE r.invited_user_id = ?
         AND r.status IN (?, ?)
       ORDER BY r.created_at DESC`,
      [req.user.id, REQUEST_STATUS.pendingUser, REQUEST_STATUS.pendingAdmin]
    );

    res.json({
      success: true,
      data: invitations
    });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load invitations'
    });
  }
});

router.post('/invitations/:requestId/respond', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Action must be accept or decline'
      });
    }

    const request = await get(
      `SELECT id, status
       FROM group_join_requests
       WHERE id = ? AND invited_user_id = ?`,
      [requestId, req.user.id]
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Join request not found'
      });
    }

    if (request.status !== REQUEST_STATUS.pendingUser) {
      return res.status(409).json({
        success: false,
        error: 'This join request has already been handled'
      });
    }

    const nextStatus = action === 'accept'
      ? REQUEST_STATUS.pendingAdmin
      : REQUEST_STATUS.declinedByUser;

    await run(
      `UPDATE group_join_requests
       SET status = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextStatus, requestId]
    );

    res.json({
      success: true,
      message: action === 'accept'
        ? 'Join request accepted. Waiting for admin approval.'
        : 'Join request declined'
    });
  } catch (error) {
    console.error('Respond invitation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to respond to join request'
    });
  }
});

router.get('/:id/member-requests', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const adminCheck = await ensureAdmin(id, req.user.id);

    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    const requests = await all(
      `SELECT r.id, r.status, r.created_at, r.responded_at,
              u.id as user_id, u.name as user_name, u.email as user_email
       FROM group_join_requests r
       JOIN users u ON r.invited_user_id = u.id
       WHERE r.group_id = ?
         AND r.status IN (?, ?)
       ORDER BY r.created_at DESC`,
      [id, REQUEST_STATUS.pendingUser, REQUEST_STATUS.pendingAdmin]
    );

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get member requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load member requests'
    });
  }
});

router.post('/:id/member-requests/:requestId/review', authenticateToken, async (req, res) => {
  try {
    const { id, requestId } = req.params;
    const { action } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Action must be approve or reject'
      });
    }

    const adminCheck = await ensureAdmin(id, req.user.id);
    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    const request = await get(
      `SELECT id, invited_user_id, status
       FROM group_join_requests
       WHERE id = ? AND group_id = ?`,
      [requestId, id]
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Join request not found'
      });
    }

    if (action === 'approve' && request.status !== REQUEST_STATUS.pendingAdmin) {
      return res.status(409).json({
        success: false,
        error: 'User must accept the join request before approval'
      });
    }

    if (![REQUEST_STATUS.pendingUser, REQUEST_STATUS.pendingAdmin].includes(request.status)) {
      return res.status(409).json({
        success: false,
        error: 'This join request has already been handled'
      });
    }

    if (action === 'approve') {
      const existingMember = await get(
        'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
        [id, request.invited_user_id]
      );

      if (!existingMember) {
        await run(
          `INSERT INTO group_members (id, group_id, user_id)
           VALUES (?, ?, ?)`,
          [uuidv4(), id, request.invited_user_id]
        );
      }

      await run(
        `UPDATE group_join_requests
         SET status = ?, responded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [REQUEST_STATUS.approved, requestId]
      );

      return res.json({
        success: true,
        message: 'Member approved and added to the group'
      });
    }

    await run(
      `UPDATE group_join_requests
       SET status = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [REQUEST_STATUS.rejectedByAdmin, requestId]
    );

    res.json({
      success: true,
      message: 'Join request rejected'
    });
  } catch (error) {
    console.error('Review member request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to review join request'
    });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const group = await getGroupById(id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    const members = await getMembers(id);

    res.json({
      success: true,
      data: {
        ...group,
        members
      }
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get group'
    });
  }
});

router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const adminCheck = await ensureAdmin(id, req.user.id);
    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    const user = await get(
      'SELECT id, name, email FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Incorrect email address. Ask the user to register first.'
      });
    }

    const existingMember = await get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [id, user.id]
    );

    if (existingMember) {
      return res.status(409).json({
        success: false,
        error: 'User is already a member of this group'
      });
    }

    const activeRequest = await getActiveJoinRequest(id, user.id);
    if (activeRequest) {
      const pendingMessage = activeRequest.status === REQUEST_STATUS.pendingUser
        ? 'A join invitation is already waiting for this user to accept.'
        : 'This user has accepted already and is waiting for admin approval.';

      return res.status(409).json({
        success: false,
        error: pendingMessage
      });
    }

    await run(
      `INSERT INTO group_join_requests (id, group_id, invited_user_id, invited_by_user_id, status)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), id, user.id, req.user.id, REQUEST_STATUS.pendingUser]
    );

    res.status(201).json({
      success: true,
      message: 'Join request sent. The user must accept it before admin approval.',
      data: {
        userId: user.id,
        userName: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Create member request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send join request'
    });
  }
});

router.delete('/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminCheck = await ensureAdmin(id, req.user.id);

    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    if (userId === adminCheck.group.admin_id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove group admin'
      });
    }

    await run(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [id, userId]
    );

    res.json({
      success: true,
      message: 'User removed from group'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member'
    });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const adminCheck = await ensureAdmin(id, req.user.id);

    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    await run(
      `UPDATE groups
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name || adminCheck.group.name, description || '', id]
    );

    res.json({
      success: true,
      message: 'Group updated successfully'
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update group'
    });
  }
});

export default router;
