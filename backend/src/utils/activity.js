import { v4 as uuidv4 } from 'uuid';
import { all, run } from '../db/index.js';

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

export async function logGroupActivity({
  groupId,
  userId = null,
  activityType,
  entityType = null,
  entityId = null,
  title,
  description,
  metadata = null
}) {
  await run(
    `INSERT INTO activity_logs (
       id, group_id, user_id, activity_type, entity_type, entity_id, title, description, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      groupId,
      userId,
      activityType,
      entityType,
      entityId,
      title,
      description,
      stringifyMetadata(metadata)
    ]
  );
}

export async function listGroupActivity(groupId, filters = {}) {
  const { month, memberId, type, search = '', limit = 100 } = filters;
  const conditions = ['al.group_id = ?'];
  const params = [groupId];

  if (month) {
    conditions.push("substr(al.created_at, 1, 7) = ?");
    params.push(month);
  }

  if (memberId) {
    conditions.push('al.user_id = ?');
    params.push(memberId);
  }

  if (type) {
    conditions.push('al.activity_type = ?');
    params.push(type);
  }

  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    conditions.push('(LOWER(al.title) LIKE ? OR LOWER(al.description) LIKE ?)');
    params.push(`%${trimmedSearch.toLowerCase()}%`, `%${trimmedSearch.toLowerCase()}%`);
  }

  params.push(Math.max(1, Math.min(Number(limit) || 100, 250)));

  const rows = await all(
    `SELECT al.id, al.group_id, al.user_id, al.activity_type, al.entity_type, al.entity_id,
            al.title, al.description, al.metadata_json, al.created_at,
            u.name AS user_name
     FROM activity_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY datetime(al.created_at) DESC
     LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata_json)
  }));
}
