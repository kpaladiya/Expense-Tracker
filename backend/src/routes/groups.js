import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { logGroupActivity } from '../utils/activity.js';
import { getDefaultCurrency, normalizeCurrencyCode } from '../utils/currency.js';
import { createMembershipPeriod, endActiveMembershipPeriod } from '../utils/membership.js';
import { notifyGroupDeletionRequested, sendGroupDeletionReport } from '../utils/notifications.js';
import { calculateSettlement } from '../utils/settlement.js';
import { createUndoAction } from '../utils/undo.js';

const router = express.Router();

const REQUEST_STATUS = {
  pendingUser: 'pending_user',
  pendingAdmin: 'pending_admin',
  approved: 'approved',
  declinedByUser: 'declined_by_user',
  rejectedByAdmin: 'rejected_by_admin'
};

const GROUP_ROLES = {
  admin: 'admin',
  coAdmin: 'co_admin',
  manager: 'manager',
  member: 'member'
};

async function getGroupById(groupId) {
  return get(
    `SELECT g.id, g.name, g.description, g.currency, g.is_disabled, g.disabled_at, g.disabled_by_user_id,
           g.admin_id, u.name as admin_name, disabled_by.name AS disabled_by_name
     FROM groups g
     LEFT JOIN users u ON g.admin_id = u.id
     LEFT JOIN users disabled_by ON disabled_by.id = g.disabled_by_user_id
     WHERE g.id = ?`,
    [groupId]
  );
}

function isOwner(group, userId) {
  return group?.admin_id === userId;
}

function buildGroupDisabledBody() {
  return {
    success: false,
    error: 'This group has been disabled and is now read-only'
  };
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
    `SELECT u.id, u.name, u.email, gm.role, gm.joined_at
     FROM users u
     JOIN group_members gm ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY u.name`,
    [groupId]
  );
}

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id, role, joined_at FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
}

function canManageInvites(group, membership, userId) {
  return isOwner(group, userId) || [GROUP_ROLES.coAdmin, GROUP_ROLES.manager].includes(membership?.role);
}

function canManageMembers(group, membership, userId) {
  return isOwner(group, userId) || membership?.role === GROUP_ROLES.coAdmin;
}

function canUpdateSettings(group, membership, userId) {
  return isOwner(group, userId) || membership?.role === GROUP_ROLES.coAdmin;
}

async function ensurePermission(groupId, userId, predicate, errorMessage) {
  const [group, membership] = await Promise.all([
    getGroupById(groupId),
    ensureGroupMember(groupId, userId)
  ]);

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

  if (!membership) {
    return {
      error: {
        status: 403,
        body: {
          success: false,
          error: 'User is not a member of this group'
        }
      }
    };
  }

  if (!predicate(group, membership, userId)) {
    return {
      error: {
        status: 403,
        body: {
          success: false,
          error: errorMessage
        }
      }
    };
  }

  return { group, membership };
}

async function getDeleteRequestByGroupId(groupId) {
  return get(
    `SELECT gdr.id, gdr.group_id, gdr.requested_by_user_id, gdr.requested_at,
            u.name AS requested_by_name, u.email AS requested_by_email
     FROM group_delete_requests gdr
     JOIN users u ON u.id = gdr.requested_by_user_id
     WHERE gdr.group_id = ?`,
    [groupId]
  );
}

async function getDeleteRequestApprovals(requestId) {
  return all(
    `SELECT gda.id, gda.user_id, gda.approved_at, u.name, u.email
     FROM group_delete_approvals gda
     JOIN users u ON u.id = gda.user_id
     WHERE gda.request_id = ?
     ORDER BY u.name`,
    [requestId]
  );
}

async function getDeletionRequestForGroup(groupId, currentUserId) {
  const deleteRequest = await getDeleteRequestByGroupId(groupId);

  if (!deleteRequest) {
    return null;
  }

  const approvals = await getDeleteRequestApprovals(deleteRequest.id);
  const approvedCount = approvals.filter((approval) => approval.approved_at).length;

  return {
    ...deleteRequest,
    approvals,
    approvedCount,
    totalApprovals: approvals.length,
    pendingApprovals: approvals.length - approvedCount,
    isApprovedByCurrentUser: approvals.some(
      (approval) => approval.user_id === currentUserId && approval.approved_at
    )
  };
}

function ensureGroupActive(group) {
  if (group?.is_disabled) {
    return {
      error: {
        status: 409,
        body: buildGroupDisabledBody()
      }
    };
  }

  return { group };
}

async function disableGroup(groupId, disabledByUserId) {
  await run(
    `UPDATE groups
     SET is_disabled = 1,
         disabled_at = CURRENT_TIMESTAMP,
         disabled_by_user_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [disabledByUserId, groupId]
  );

  await run(
    `UPDATE group_join_requests
     SET status = ?, responded_at = CURRENT_TIMESTAMP
     WHERE group_id = ?
       AND status IN (?, ?)`,
    [REQUEST_STATUS.rejectedByAdmin, groupId, REQUEST_STATUS.pendingUser, REQUEST_STATUS.pendingAdmin]
  );

  await logGroupActivity({
    groupId,
    userId: disabledByUserId,
    activityType: 'group_disabled',
    entityType: 'group',
    entityId: groupId,
    title: 'Group disabled',
    description: 'This group is now read-only'
  });
}

async function finalizeGroupDeletion(groupId) {
  const group = await getGroupById(groupId);
  let warning;

  try {
    warning = await sendGroupDeletionReport({ groupId });
  } catch (reportError) {
    console.error('Group deletion report error:', reportError);
    warning = 'Group disabled, but the final report email could not be delivered.';
  }

  await disableGroup(groupId, group?.admin_id || null);

  return warning;
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
    const { name, description, currency } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Group name is required'
      });
    }

    const normalizedCurrency = normalizeCurrencyCode(currency || getDefaultCurrency());

    if (!normalizedCurrency) {
      return res.status(400).json({
        success: false,
        error: 'A valid currency code is required'
      });
    }

    const groupId = uuidv4();

    await run(
      `INSERT INTO groups (id, name, description, currency, admin_id)
       VALUES (?, ?, ?, ?, ?)`,
      [groupId, name, description || '', normalizedCurrency, req.user.id]
    );

    await run(
      `INSERT INTO group_members (id, group_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), groupId, req.user.id, GROUP_ROLES.admin]
    );
    await createMembershipPeriod(groupId, req.user.id, req.user.id);
    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'group_created',
      entityType: 'group',
      entityId: groupId,
      title: 'Group created',
      description: `Created group "${name}"`
    });

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: {
        id: groupId,
        name,
        description,
        currency: normalizedCurrency,
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

router.get('/personal-summary', authenticateToken, async (req, res) => {
  try {
    const groups = await all(
      `SELECT g.id, g.name, g.currency, g.is_disabled, gm.role
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );

    const summaries = await Promise.all(
      groups.map(async (group) => {
        const settlement = await calculateSettlement(group.id, { excludeSettledMonths: true });
        const balance = settlement.memberBalances.find((member) => member.id === req.user.id)?.balance || 0;
        return {
          groupId: group.id,
          groupName: group.name,
          currency: group.currency,
          role: group.role,
          isDisabled: Boolean(group.is_disabled),
          balance
        };
      })
    );

    const getsTotal = summaries
      .filter((item) => item.balance > 0)
      .reduce((sum, item) => sum + item.balance, 0);
    const owesTotal = Math.abs(
      summaries
        .filter((item) => item.balance < 0)
        .reduce((sum, item) => sum + item.balance, 0)
    );

    res.json({
      success: true,
      data: {
        getsTotal,
        owesTotal,
        netBalance: getsTotal - owesTotal,
        groups: summaries
      }
    });
  } catch (error) {
    console.error('Get personal summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load personal summary'
    });
  }
});

router.post('/sample', authenticateToken, async (req, res) => {
  try {
    const groupId = uuidv4();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const previousMonthDate = new Date();
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonth = previousMonthDate.toISOString().slice(0, 7);

    await run(
      `INSERT INTO groups (id, name, description, currency, admin_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        groupId,
        'Sample Coffee Club',
        'Example data so you can explore expenses, payments, settlements, and reports.',
        'EUR',
        req.user.id
      ]
    );
    await run(
      `INSERT INTO group_members (id, group_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), groupId, req.user.id, GROUP_ROLES.admin]
    );
    await createMembershipPeriod(groupId, req.user.id, req.user.id);

    await run(
      `INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), groupId, req.user.id, 38.5, 'Coffee beans', `${previousMonth}-04`,
        uuidv4(), groupId, req.user.id, 21.75, 'Milk and sugar', `${currentMonth}-06`
      ]
    );
    await run(
      `INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), groupId, req.user.id, 60, 'Cash', 'Morning orders', `${previousMonth}-10`,
        uuidv4(), groupId, req.user.id, 54.2, 'Cash', 'Office delivery', `${currentMonth}-11`
      ]
    );
    await run(
      `INSERT INTO settled_months (id, group_id, month, settled_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), groupId, previousMonth, req.user.id]
    );
    await run(
      `UPDATE users
       SET onboarding_completed = 1,
           onboarding_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id]
    );

    await logGroupActivity({
      groupId,
      userId: req.user.id,
      activityType: 'sample_group_created',
      entityType: 'group',
      entityId: groupId,
      title: 'Sample group created',
      description: 'Created a sample group with example records'
    });

    res.status(201).json({
      success: true,
      message: 'Sample example created successfully',
      data: {
        id: groupId
      }
    });
  } catch (error) {
    console.error('Create sample group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create sample example'
    });
  }
});

router.get('/deletion-requests/pending', authenticateToken, async (req, res) => {
  try {
    const requests = await all(
      `SELECT gdr.id, gdr.group_id, gdr.requested_at,
              g.name AS group_name,
              requester.id AS requested_by_user_id,
              requester.name AS requested_by_name,
              (
                SELECT COUNT(*)
                FROM group_delete_approvals approvals
                WHERE approvals.request_id = gdr.id
                  AND approvals.approved_at IS NOT NULL
              ) AS approved_count,
              (
                SELECT COUNT(*)
                FROM group_delete_approvals approvals
                WHERE approvals.request_id = gdr.id
              ) AS total_approvals
       FROM group_delete_requests gdr
       JOIN group_delete_approvals gda
         ON gda.request_id = gdr.id
        AND gda.user_id = ?
        AND gda.approved_at IS NULL
       JOIN groups g ON g.id = gdr.group_id
       JOIN users requester ON requester.id = gdr.requested_by_user_id
       ORDER BY gdr.requested_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get pending deletion requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load pending group disable approvals'
    });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const groups = await all(
      `SELECT g.id, g.name, g.description, g.currency, g.is_disabled, g.disabled_at, g.disabled_by_user_id, g.admin_id,
             membership.role AS current_user_role,
              u.name as admin_name,
              COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.admin_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN group_members membership ON membership.group_id = g.id AND membership.user_id = ?
       WHERE g.id IN (
         SELECT group_id FROM group_members WHERE user_id = ?
       )
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      [req.user.id, req.user.id]
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
             g.is_disabled,
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
      `SELECT r.id, r.status, g.is_disabled
       FROM group_join_requests r
       JOIN groups g ON g.id = r.group_id
       WHERE r.id = ? AND r.invited_user_id = ?`,
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

    if (request.is_disabled) {
      return res.status(409).json(buildGroupDisabledBody());
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
    const permission = await ensurePermission(
      id,
      req.user.id,
      canManageInvites,
      'Only the group owner, co-admin, or manager can review member requests'
    );

    if (permission.error) {
      return res.status(permission.error.status).json(permission.error.body);
    }

    const activeCheck = ensureGroupActive(permission.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
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

    const permission = await ensurePermission(
      id,
      req.user.id,
      canManageInvites,
      'Only the group owner, co-admin, or manager can review member requests'
    );
    if (permission.error) {
      return res.status(permission.error.status).json(permission.error.body);
    }

    const activeCheck = ensureGroupActive(permission.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const deleteRequest = await getDeleteRequestByGroupId(id);

    if (deleteRequest) {
      return res.status(409).json({
        success: false,
        error: 'Cannot review member requests while a group disable approval is pending'
      });
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
          `INSERT INTO group_members (id, group_id, user_id, role)
           VALUES (?, ?, ?, ?)`,
          [uuidv4(), id, request.invited_user_id, GROUP_ROLES.member]
        );
        await createMembershipPeriod(id, request.invited_user_id, req.user.id);
      }

      await run(
        `UPDATE group_join_requests
         SET status = ?, responded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [REQUEST_STATUS.approved, requestId]
      );

      await logGroupActivity({
        groupId: id,
        userId: req.user.id,
        activityType: 'member_added',
        entityType: 'member',
        entityId: request.invited_user_id,
        title: 'Member approved',
        description: 'Approved a pending member request'
      });

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

    const [group, currentMembership] = await Promise.all([
      getGroupById(id),
      ensureGroupMember(id, req.user.id)
    ]);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    if (!currentMembership) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const [members, deletionRequest] = await Promise.all([
      getMembers(id),
      getDeletionRequestForGroup(id, req.user.id)
    ]);

    res.json({
      success: true,
      data: {
        ...group,
        members,
        deletionRequest,
        currentUserRole: currentMembership?.role || GROUP_ROLES.member
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

router.post('/:id/delete-request', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const adminCheck = await ensureAdmin(id, req.user.id);

    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    const activeCheck = ensureGroupActive(adminCheck.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const existingRequest = await getDeleteRequestByGroupId(id);

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        error: 'A group disable approval request is already pending'
      });
    }

    const members = await getMembers(id);

    if (members.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Group has no members to approve disabling'
      });
    }

    const requestId = uuidv4();

    await run(
      `INSERT INTO group_delete_requests (id, group_id, requested_by_user_id)
       VALUES (?, ?, ?)`,
      [requestId, id, req.user.id]
    );

    for (const member of members) {
      await run(
        `INSERT INTO group_delete_approvals (id, request_id, group_id, user_id, approved_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          requestId,
          id,
          member.id,
          member.id === req.user.id ? new Date().toISOString() : null
        ]
      );
    }

    let warning;
    try {
      warning = await notifyGroupDeletionRequested({
        groupId: id,
        actorUserId: req.user.id
      });
    } catch (notificationError) {
      console.error('Group deletion request notification error:', notificationError);
      warning = 'Disable request created, but email notifications could not be sent.';
    }

    const deletionRequest = await getDeletionRequestForGroup(id, req.user.id);

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'group_disable_requested',
      entityType: 'group',
      entityId: id,
      title: 'Disable approval requested',
      description: 'Started group disable approval flow'
    });

    if (deletionRequest?.pendingApprovals === 0) {
      const deleteWarning = await finalizeGroupDeletion(id);
      return res.status(201).json({
        success: true,
        message: 'All approvals were already complete. The group has been disabled.',
        ...(warning || deleteWarning ? { warning: [warning, deleteWarning].filter(Boolean).join(' ') } : {}),
        data: {
          disabled: true
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Disable approval request sent to all group members',
      ...(warning ? { warning } : {}),
      data: deletionRequest
    });
  } catch (error) {
    console.error('Create group delete request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create group disable request'
    });
  }
});

router.post('/:id/delete-request/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const member = await ensureGroupMember(id, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const group = await getGroupById(id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    const activeCheck = ensureGroupActive(group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const deleteRequest = await getDeleteRequestByGroupId(id);

    if (!deleteRequest) {
      return res.status(404).json({
        success: false,
        error: 'There is no pending disable approval request for this group'
      });
    }

    const approval = await get(
      `SELECT id, approved_at
       FROM group_delete_approvals
       WHERE request_id = ? AND user_id = ?`,
      [deleteRequest.id, req.user.id]
    );

    if (!approval) {
      return res.status(404).json({
        success: false,
        error: 'Approval record not found for this user'
      });
    }

    if (approval.approved_at) {
      return res.status(409).json({
        success: false,
        error: 'You have already approved this group disable request'
      });
    }

    await run(
      `UPDATE group_delete_approvals
       SET approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [approval.id]
    );

    const deletionRequest = await getDeletionRequestForGroup(id, req.user.id);

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'group_disable_approved',
      entityType: 'group',
      entityId: id,
      title: 'Disable approval recorded',
      description: 'Approved the group disable request'
    });

    if (deletionRequest?.pendingApprovals === 0) {
      const warning = await finalizeGroupDeletion(id);
      return res.json({
        success: true,
        message: 'All group members approved the request. The group has been disabled.',
        ...(warning ? { warning } : {}),
        data: {
          disabled: true
        }
      });
    }

    res.json({
      success: true,
      message: 'Approval saved. Waiting for the remaining members.',
      data: deletionRequest
    });
  } catch (error) {
    console.error('Approve group delete request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve group disable request'
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

    const permission = await ensurePermission(
      id,
      req.user.id,
      canManageInvites,
      'Only the group owner, co-admin, or manager can invite members'
    );
    if (permission.error) {
      return res.status(permission.error.status).json(permission.error.body);
    }

    const activeCheck = ensureGroupActive(permission.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const deleteRequest = await getDeleteRequestByGroupId(id);

    if (deleteRequest) {
      return res.status(409).json({
        success: false,
        error: 'Cannot invite new members while a group disable approval is pending'
      });
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

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'member_invited',
      entityType: 'member_request',
      entityId: user.id,
      title: 'Member invited',
      description: `Sent a join request to ${user.name}`
    });

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
    const reason = req.body?.reason?.trim();
    const permission = await ensurePermission(
      id,
      req.user.id,
      canManageMembers,
      'Only the group owner or co-admin can remove members'
    );

    if (permission.error) {
      return res.status(permission.error.status).json(permission.error.body);
    }

    const activeCheck = ensureGroupActive(permission.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const deleteRequest = await getDeleteRequestByGroupId(id);

    if (deleteRequest) {
      return res.status(409).json({
        success: false,
        error: 'Cannot remove members while a group disable approval is pending'
      });
    }

    if (userId === permission.group.admin_id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove group admin'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Removal reason is required'
      });
    }

    const member = await get(
      `SELECT gm.id AS membership_id, gm.role, gm.joined_at, u.id, u.name
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND gm.user_id = ?`,
      [id, userId]
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        error: 'Member not found in this group'
      });
    }

    await createUndoAction({
      userId: req.user.id,
      groupId: id,
      actionType: 'member_removed',
      entityType: 'member',
      entityId: userId,
      payload: {
        mode: 'restore-member',
        record: {
          id: member.membership_id,
          group_id: id,
          user_id: userId,
          role: member.role,
          joined_at: member.joined_at
        }
      }
    });

    await run(
      `INSERT INTO member_removals (id, group_id, removed_user_id, removed_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), id, userId, req.user.id, reason]
    );
    await endActiveMembershipPeriod(id, userId, req.user.id, reason);

    await run(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [id, userId]
    );

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'member_removed',
      entityType: 'member',
      entityId: userId,
      title: 'Member removed',
      description: `Removed ${member.name} from the group`,
      metadata: {
        reason
      }
    });

    res.json({
      success: true,
      message: `${member.name} removed from group`,
      data: {
        removedUserId: userId,
        reason
      }
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member'
    });
  }
});

router.put('/:id/members/:userId/role', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;
    const adminCheck = await ensureAdmin(id, req.user.id);

    if (adminCheck.error) {
      return res.status(adminCheck.error.status).json(adminCheck.error.body);
    }

    const activeCheck = ensureGroupActive(adminCheck.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    if (![GROUP_ROLES.coAdmin, GROUP_ROLES.manager, GROUP_ROLES.member].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be co_admin, manager, or member'
      });
    }

    if (userId === adminCheck.group.admin_id) {
      return res.status(400).json({
        success: false,
        error: 'The group owner always keeps the admin role'
      });
    }

    const member = await get(
      `SELECT gm.id, gm.role, u.name
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND gm.user_id = ?`,
      [id, userId]
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        error: 'Member not found in this group'
      });
    }

    await run(
      `UPDATE group_members
       SET role = ?
       WHERE group_id = ? AND user_id = ?`,
      [role, id, userId]
    );

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'member_role_updated',
      entityType: 'member',
      entityId: userId,
      title: 'Member role updated',
      description: `Changed ${member.name}'s role to ${role.replace('_', ' ')}`
    });

    res.json({
      success: true,
      message: `${member.name}'s role updated successfully`
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update member role'
    });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, currency } = req.body;
    const permission = await ensurePermission(
      id,
      req.user.id,
      canUpdateSettings,
      'Only the group owner or co-admin can update group settings'
    );

    if (permission.error) {
      return res.status(permission.error.status).json(permission.error.body);
    }

    const activeCheck = ensureGroupActive(permission.group);
    if (activeCheck.error) {
      return res.status(activeCheck.error.status).json(activeCheck.error.body);
    }

    const nextCurrency = currency
      ? normalizeCurrencyCode(currency)
      : permission.group.currency;

    if (!nextCurrency) {
      return res.status(400).json({
        success: false,
        error: 'A valid currency code is required'
      });
    }

    await run(
      `UPDATE groups
       SET name = ?, description = ?, currency = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name || permission.group.name, description || '', nextCurrency, id]
    );

    await logGroupActivity({
      groupId: id,
      userId: req.user.id,
      activityType: 'group_updated',
      entityType: 'group',
      entityId: id,
      title: 'Group settings updated',
      description: 'Updated group name, description, or currency'
    });

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
