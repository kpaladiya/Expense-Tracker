import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureActivityLogsTable,
  ensureExpensePaymentAttachmentColumns,
  ensureFeedbackSupportTable,
  ensureGroupCurrencyColumn,
  ensureGroupDisabledColumns,
  ensureGroupDeleteApprovalTables,
  ensureGroupMemberRoleColumn,
  ensureInboxNotificationsTable,
  ensureMemberRemovalTable,
  ensureMembershipPeriodsTable,
  ensureRecurringTemplatesTable,
  ensureUndoActionsTable,
  ensureUserVerificationColumns
} from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_EMAILS = [
  'admin@example.com',
  'usera@example.com',
  'userb@example.com',
  'userc@example.com'
];

// Database path
const dbPath = path.join(__dirname, '../../data/app.db');
const dataDir = path.dirname(dbPath);

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new sqlite3.Database(dbPath);

// Read schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function createPlaceholders(values) {
  return values.map(() => '?').join(', ');
}

async function removeLegacyDemoData() {
  const demoUsers = await allAsync(
    `SELECT id FROM users WHERE email IN (${createPlaceholders(DEMO_EMAILS)})`,
    DEMO_EMAILS
  );

  if (demoUsers.length === 0) {
    return false;
  }

  const demoUserIds = demoUsers.map((user) => user.id);
  const demoUserPlaceholders = createPlaceholders(demoUserIds);
  const demoGroups = await allAsync(
    `SELECT id FROM groups WHERE admin_id IN (${demoUserPlaceholders})`,
    demoUserIds
  );
  const demoGroupIds = demoGroups.map((group) => group.id);

  if (demoGroupIds.length > 0) {
    const demoGroupPlaceholders = createPlaceholders(demoGroupIds);

    await runAsync(
      `DELETE FROM group_join_requests WHERE group_id IN (${demoGroupPlaceholders})`,
      demoGroupIds
    );
    await runAsync(
      `DELETE FROM expenses WHERE group_id IN (${demoGroupPlaceholders})`,
      demoGroupIds
    );
    await runAsync(
      `DELETE FROM payments WHERE group_id IN (${demoGroupPlaceholders})`,
      demoGroupIds
    );
    await runAsync(
      `DELETE FROM group_members WHERE group_id IN (${demoGroupPlaceholders})`,
      demoGroupIds
    );
    await runAsync(
      `DELETE FROM groups WHERE id IN (${demoGroupPlaceholders})`,
      demoGroupIds
    );
  }

  await runAsync(
    `DELETE FROM group_join_requests
     WHERE invited_user_id IN (${demoUserPlaceholders})
        OR invited_by_user_id IN (${demoUserPlaceholders})`,
    [...demoUserIds, ...demoUserIds]
  );
  await runAsync(
    `DELETE FROM expenses WHERE user_id IN (${demoUserPlaceholders})`,
    demoUserIds
  );
  await runAsync(
    `DELETE FROM payments WHERE user_id IN (${demoUserPlaceholders})`,
    demoUserIds
  );
  await runAsync(
    `DELETE FROM group_members WHERE user_id IN (${demoUserPlaceholders})`,
    demoUserIds
  );
  await runAsync(
    `DELETE FROM users WHERE id IN (${demoUserPlaceholders})`,
    demoUserIds
  );

  return true;
}

// Execute schema
db.exec(schema, async (err) => {
  if (err) {
    console.error('Error executing schema:', err);
    process.exit(1);
  }

  console.log('✓ Database schema created');

  try {
    await ensureGroupCurrencyColumn(db);
    await ensureGroupDisabledColumns(db);
    await ensureUserVerificationColumns(db);
    await ensureFeedbackSupportTable(db);
    await ensureMemberRemovalTable(db);
    await ensureMembershipPeriodsTable(db);
    await ensureGroupDeleteApprovalTables(db);
    await ensureGroupMemberRoleColumn(db);
    await ensureExpensePaymentAttachmentColumns(db);
    await ensureInboxNotificationsTable(db);
    await ensureActivityLogsTable(db);
    await ensureRecurringTemplatesTable(db);
    await ensureUndoActionsTable(db);
    const removedDemoData = await removeLegacyDemoData();
    const row = await getAsync('SELECT COUNT(*) as count FROM users');

    if (removedDemoData) {
      console.log('✓ Removed legacy demo users and sample data');
    }

    console.log('\n✅ Database initialized successfully!');

    if (row.count > 0) {
      console.log('Existing data is ready.');
    } else {
      console.log('No users found. Create your first account from the app.');
    }

    await closeDatabase();
  } catch (migrationError) {
    console.error('Error initializing database:', migrationError);
    process.exit(1);
  }
});
