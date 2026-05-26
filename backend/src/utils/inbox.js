import { v4 as uuidv4 } from 'uuid';
import { all, get, run } from '../db/index.js';

function stringifyMetadata(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  return JSON.stringify(metadata);
}

function parseMetadata(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function createInboxNotification({
  userId,
  groupId = null,
  type,
  title,
  message,
  actionUrl = null,
  metadata = null,
  dedupeKey = null
}) {
  await run(
    `INSERT OR IGNORE INTO inbox_notifications (
       id, user_id, group_id, type, title, message, action_url, metadata_json, dedupe_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      userId,
      groupId,
      type,
      title,
      message,
      actionUrl,
      stringifyMetadata(metadata),
      dedupeKey
    ]
  );
}

export async function createInboxNotifications(entries) {
  for (const entry of entries) {
    await createInboxNotification(entry);
  }
}

export async function listInboxNotifications(userId, options = {}) {
  const { unreadOnly = false, limit = 50 } = options;
  const rows = await all(
    `SELECT inbox.id, inbox.user_id, inbox.group_id, inbox.type, inbox.title, inbox.message,
            inbox.action_url, inbox.metadata_json, inbox.is_read, inbox.read_at, inbox.created_at,
            g.name AS group_name
     FROM inbox_notifications inbox
     LEFT JOIN groups g ON g.id = inbox.group_id
     WHERE inbox.user_id = ?
       ${unreadOnly ? 'AND inbox.is_read = 0' : ''}
     ORDER BY datetime(inbox.created_at) DESC
     LIMIT ?`,
    [userId, Math.max(1, Math.min(Number(limit) || 50, 200))]
  );

  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata_json),
    isRead: row.is_read === 1,
    actionUrl: row.action_url
  }));
}

export async function getUnreadInboxCount(userId) {
  const row = await get(
    `SELECT COUNT(*) AS count
     FROM inbox_notifications
     WHERE user_id = ? AND is_read = 0`,
    [userId]
  );

  return Number(row?.count || 0);
}

export async function markInboxNotificationRead(userId, notificationId) {
  await run(
    `UPDATE inbox_notifications
     SET is_read = 1,
         read_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
}

export async function markAllInboxNotificationsRead(userId) {
  await run(
    `UPDATE inbox_notifications
     SET is_read = 1,
         read_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
}
