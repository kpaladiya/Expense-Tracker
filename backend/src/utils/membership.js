import { v4 as uuidv4 } from 'uuid';
import { get, run } from '../db/index.js';

export function toDateOnly(value) {
  return String(value || '').slice(0, 10);
}

export async function createMembershipPeriod(groupId, userId, createdByUserId, startedAt = null) {
  await run(
    `INSERT INTO group_membership_periods (id, group_id, user_id, started_at, created_by_user_id)
     VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`,
    [uuidv4(), groupId, userId, startedAt, createdByUserId || null]
  );
}

export async function endActiveMembershipPeriod(groupId, userId, endedByUserId, reason) {
  return run(
    `UPDATE group_membership_periods
     SET ended_at = CURRENT_TIMESTAMP,
         ended_by_user_id = ?,
         removal_reason = ?
     WHERE id = (
       SELECT id
       FROM group_membership_periods
       WHERE group_id = ? AND user_id = ? AND ended_at IS NULL
       ORDER BY datetime(started_at) DESC
       LIMIT 1
     )`,
    [endedByUserId || null, reason || null, groupId, userId]
  );
}

export async function getMembershipPeriodForDate(groupId, userId, date) {
  const normalizedDate = toDateOnly(date);

  if (!normalizedDate) {
    return null;
  }

  return get(
    `SELECT id, group_id, user_id, started_at, ended_at
     FROM group_membership_periods
     WHERE group_id = ?
       AND user_id = ?
       AND substr(started_at, 1, 10) <= ?
       AND (ended_at IS NULL OR substr(ended_at, 1, 10) >= ?)
     ORDER BY datetime(started_at) DESC
     LIMIT 1`,
    [groupId, userId, normalizedDate, normalizedDate]
  );
}
