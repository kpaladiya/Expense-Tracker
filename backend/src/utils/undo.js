import { v4 as uuidv4 } from 'uuid';
import { get, run } from '../db/index.js';
import { createMembershipPeriod, endActiveMembershipPeriod } from './membership.js';
import { removeStoredAttachment } from './uploads.js';

const UNDO_WINDOW_MINUTES = 15;

function stringifyPayload(payload) {
  return JSON.stringify(payload);
}

function parsePayload(payloadJson) {
  return JSON.parse(payloadJson);
}

function getExpiryIso() {
  return new Date(Date.now() + UNDO_WINDOW_MINUTES * 60 * 1000).toISOString();
}

function buildUndoLabel(action) {
  switch (action.mode) {
    case 'delete-expense':
      return 'Undo expense add';
    case 'restore-expense':
      return 'Undo expense delete';
    case 'revert-expense':
      return 'Undo expense edit';
    case 'delete-payment':
      return 'Undo payment add';
    case 'restore-payment':
      return 'Undo payment delete';
    case 'revert-payment':
      return 'Undo payment edit';
    case 'restore-member':
      return 'Undo member removal';
    default:
      return 'Undo recent action';
  }
}

export async function createUndoAction({ userId, groupId = null, actionType, entityType, entityId = null, payload }) {
  await run(
    `INSERT INTO undo_actions (
       id, user_id, group_id, action_type, entity_type, entity_id, payload_json, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), userId, groupId, actionType, entityType, entityId, stringifyPayload(payload), getExpiryIso()]
  );
}

export async function getLatestUndoAction(userId) {
  const row = await get(
    `SELECT id, user_id, group_id, action_type, entity_type, entity_id, payload_json, expires_at, created_at
     FROM undo_actions
     WHERE user_id = ?
       AND undone_at IS NULL
       AND datetime(expires_at) >= datetime('now')
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [userId]
  );

  if (!row) {
    return null;
  }

  const payload = parsePayload(row.payload_json);

  return {
    ...row,
    payload,
    label: buildUndoLabel(payload)
  };
}

async function restoreExpense(record) {
  await run(
    `INSERT INTO expenses (
       id, group_id, user_id, amount, note, attachment_name, attachment_path, attachment_mime_type, attachment_size, expense_date, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.group_id,
      record.user_id,
      record.amount,
      record.note,
      record.attachment_name,
      record.attachment_path,
      record.attachment_mime_type,
      record.attachment_size,
      record.expense_date,
      record.created_at,
      record.updated_at
    ]
  );
}

async function restorePayment(record) {
  await run(
    `INSERT INTO payments (
       id, group_id, user_id, amount, payment_method, customer_note, attachment_name, attachment_path, attachment_mime_type, attachment_size, payment_date, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.group_id,
      record.user_id,
      record.amount,
      record.payment_method,
      record.customer_note,
      record.attachment_name,
      record.attachment_path,
      record.attachment_mime_type,
      record.attachment_size,
      record.payment_date,
      record.created_at,
      record.updated_at
    ]
  );
}

export async function undoAction({ actionId, userId }) {
  const row = await get(
    `SELECT id, user_id, group_id, action_type, entity_type, entity_id, payload_json, expires_at
     FROM undo_actions
     WHERE id = ?
       AND user_id = ?
       AND undone_at IS NULL
       AND datetime(expires_at) >= datetime('now')`,
    [actionId, userId]
  );

  if (!row) {
    return null;
  }

  const action = parsePayload(row.payload_json);

  switch (action.mode) {
    case 'delete-expense':
      await run('DELETE FROM expenses WHERE id = ?', [action.record.id]);
      removeStoredAttachment(action.record.attachment_path);
      break;
    case 'restore-expense':
      await restoreExpense(action.record);
      break;
    case 'revert-expense':
      await run(
        `UPDATE expenses
         SET amount = ?, note = ?, attachment_name = ?, attachment_path = ?, attachment_mime_type = ?, attachment_size = ?,
             expense_date = ?, created_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          action.previous.amount,
          action.previous.note,
          action.previous.attachment_name,
          action.previous.attachment_path,
          action.previous.attachment_mime_type,
          action.previous.attachment_size,
          action.previous.expense_date,
          action.previous.created_at,
          action.previous.updated_at,
          action.previous.id
        ]
      );
      break;
    case 'delete-payment':
      await run('DELETE FROM payments WHERE id = ?', [action.record.id]);
      removeStoredAttachment(action.record.attachment_path);
      break;
    case 'restore-payment':
      await restorePayment(action.record);
      break;
    case 'revert-payment':
      await run(
        `UPDATE payments
         SET amount = ?, payment_method = ?, customer_note = ?, attachment_name = ?, attachment_path = ?, attachment_mime_type = ?, attachment_size = ?,
             payment_date = ?, created_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          action.previous.amount,
          action.previous.payment_method,
          action.previous.customer_note,
          action.previous.attachment_name,
          action.previous.attachment_path,
          action.previous.attachment_mime_type,
          action.previous.attachment_size,
          action.previous.payment_date,
          action.previous.created_at,
          action.previous.updated_at,
          action.previous.id
        ]
      );
      break;
    case 'restore-member':
      await run(
        `INSERT INTO group_members (id, group_id, user_id, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          action.record.id,
          action.record.group_id,
          action.record.user_id,
          action.record.role,
          action.record.joined_at
        ]
      );
      await createMembershipPeriod(action.record.group_id, action.record.user_id, userId, action.record.joined_at);
      break;
    case 'remove-member':
      await endActiveMembershipPeriod(action.record.group_id, action.record.user_id, userId, 'Undo action');
      await run(
        'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
        [action.record.group_id, action.record.user_id]
      );
      break;
    default:
      throw new Error('This action cannot be undone');
  }

  await run(
    `UPDATE undo_actions
     SET undone_at = CURRENT_TIMESTAMP,
         undone_by_user_id = ?
     WHERE id = ?`,
    [userId, actionId]
  );

  return {
    ...row,
    payload: action,
    label: buildUndoLabel(action)
  };
}
