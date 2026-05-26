import bcrypt from 'bcryptjs';
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
const schemaPath = path.join(__dirname, 'schema.sql');
const DEVELOPMENT_DUMMY_USER = {
  id: 'dev-dummy-user',
  email: 'demo@sharedexpenses.local',
  password: 'demo1234',
  name: 'Demo User'
};

let db;

function resolveDbPath() {
  const configuredPath = process.env.DATABASE_PATH || './data/app.db';
  return path.resolve(process.cwd(), configuredPath);
}

function ensureDataDirectory(dbPath) {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function openDatabase() {
  if (db) {
    return db;
  }

  const dbPath = resolveDbPath();
  ensureDataDirectory(dbPath);

  db = new sqlite3.Database(dbPath);
  return db;
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    openDatabase().exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function initializeDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await exec(schema);
  await ensureGroupCurrencyColumn(openDatabase());
  await ensureGroupDisabledColumns(openDatabase());
  await ensureUserVerificationColumns(openDatabase());
  await ensureFeedbackSupportTable(openDatabase());
  await ensureMemberRemovalTable(openDatabase());
  await ensureMembershipPeriodsTable(openDatabase());
  await ensureGroupDeleteApprovalTables(openDatabase());
  await ensureGroupMemberRoleColumn(openDatabase());
  await ensureExpensePaymentAttachmentColumns(openDatabase());
  await ensureInboxNotificationsTable(openDatabase());
  await ensureActivityLogsTable(openDatabase());
  await ensureRecurringTemplatesTable(openDatabase());
  await ensureUndoActionsTable(openDatabase());
  await ensureDevelopmentDummyUser();
}

async function ensureDevelopmentDummyUser() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const passwordHash = bcrypt.hashSync(DEVELOPMENT_DUMMY_USER.password, 10);
  const existingUser = await get(
    'SELECT id FROM users WHERE email = ?',
    [DEVELOPMENT_DUMMY_USER.email]
  );

  if (existingUser) {
    await run(
      `UPDATE users
       SET password_hash = ?,
           name = ?,
           email_verified = 1,
           onboarding_completed = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, DEVELOPMENT_DUMMY_USER.name, existingUser.id]
    );
  } else {
    await run(
      `INSERT INTO users (
         id, email, password_hash, name, is_admin, onboarding_completed, email_verified
       ) VALUES (?, ?, ?, ?, 0, 1, 1)`,
      [
        DEVELOPMENT_DUMMY_USER.id,
        DEVELOPMENT_DUMMY_USER.email,
        passwordHash,
        DEVELOPMENT_DUMMY_USER.name
      ]
    );
  }
}

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().run(sql, params, function handleRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

export function closeDb() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }

    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      db = undefined;
      resolve();
    });
  });
}
