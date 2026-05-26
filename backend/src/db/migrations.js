function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function normalizeTicketNumber(id) {
  return `FDB-${String(id || '').replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

export async function ensureUserVerificationColumns(db) {
  const columns = await all(db, 'PRAGMA table_info(users)');
  const columnNames = new Set(columns.map((column) => column.name));

  const addedEmailVerified = !columnNames.has('email_verified');

  if (addedEmailVerified) {
    await run(db, 'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
  }

  if (!columnNames.has('email_verification_token')) {
    await run(db, 'ALTER TABLE users ADD COLUMN email_verification_token TEXT');
  }

  if (!columnNames.has('email_verification_expires_at')) {
    await run(db, 'ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME');
  }

  if (!columnNames.has('email_verification_sent_at')) {
    await run(db, 'ALTER TABLE users ADD COLUMN email_verification_sent_at DATETIME');
  }

  if (!columnNames.has('google_id')) {
    await run(db, 'ALTER TABLE users ADD COLUMN google_id TEXT');
  }

  if (!columnNames.has('onboarding_completed')) {
    await run(db, 'ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnNames.has('onboarding_seen_at')) {
    await run(db, 'ALTER TABLE users ADD COLUMN onboarding_seen_at DATETIME');
  }

  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token)'
  );
  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)'
  );

  if (addedEmailVerified) {
    await run(db, 'UPDATE users SET email_verified = 1 WHERE email_verified = 0 OR email_verified IS NULL');
  } else {
    await run(db, 'UPDATE users SET email_verified = 1 WHERE email_verified IS NULL');
  }
}

export async function ensureGroupCurrencyColumn(db) {
  const columns = await all(db, 'PRAGMA table_info(groups)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('currency')) {
    await run(db, "ALTER TABLE groups ADD COLUMN currency TEXT DEFAULT 'EUR'");
  }

  await run(db, "UPDATE groups SET currency = 'EUR' WHERE currency IS NULL OR currency = ''");
}

export async function ensureGroupDisabledColumns(db) {
  const columns = await all(db, 'PRAGMA table_info(groups)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('is_disabled')) {
    await run(db, "ALTER TABLE groups ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0");
  }

  if (!columnNames.has('disabled_at')) {
    await run(db, 'ALTER TABLE groups ADD COLUMN disabled_at DATETIME');
  }

  if (!columnNames.has('disabled_by_user_id')) {
    await run(db, 'ALTER TABLE groups ADD COLUMN disabled_by_user_id TEXT');
  }

  await run(db, 'UPDATE groups SET is_disabled = 0 WHERE is_disabled IS NULL');
}

export async function ensureFeedbackSupportTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS feedback_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('bug', 'feature', 'help', 'general')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      ticket_number TEXT,
      terms_accepted INTEGER NOT NULL DEFAULT 0 CHECK(terms_accepted IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'closed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  const columns = await all(db, 'PRAGMA table_info(feedback_submissions)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('ticket_number')) {
    await run(db, 'ALTER TABLE feedback_submissions ADD COLUMN ticket_number TEXT');
  }

  if (!columnNames.has('terms_accepted')) {
    await run(db, 'ALTER TABLE feedback_submissions ADD COLUMN terms_accepted INTEGER NOT NULL DEFAULT 0');
  }

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_id ON feedback_submissions(user_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_feedback_submissions_category ON feedback_submissions(category)'
  );
  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_submissions_ticket_number ON feedback_submissions(ticket_number)'
  );

  const missingTicketNumbers = await all(
    db,
    `SELECT id
     FROM feedback_submissions
     WHERE ticket_number IS NULL OR ticket_number = ''`
  );

  for (const row of missingTicketNumbers) {
    await run(
      db,
      'UPDATE feedback_submissions SET ticket_number = ? WHERE id = ?',
      [normalizeTicketNumber(row.id), row.id]
    );
  }

  await run(
    db,
    'UPDATE feedback_submissions SET terms_accepted = 1 WHERE terms_accepted IS NULL OR terms_accepted = 0'
  );
}

export async function ensureMemberRemovalTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS member_removals (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      removed_user_id TEXT NOT NULL,
      removed_by_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (removed_user_id) REFERENCES users(id),
      FOREIGN KEY (removed_by_user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_member_removals_group_id ON member_removals(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_member_removals_removed_user_id ON member_removals(removed_user_id)'
  );
}

export async function ensureMembershipPeriodsTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS group_membership_periods (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      created_by_user_id TEXT,
      ended_by_user_id TEXT,
      removal_reason TEXT,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      FOREIGN KEY (ended_by_user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_group_membership_periods_group_id ON group_membership_periods(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_group_membership_periods_user_id ON group_membership_periods(user_id)'
  );

  const activeMembers = await all(
    db,
    `SELECT gm.id, gm.group_id, gm.user_id, gm.joined_at
     FROM group_members gm
     LEFT JOIN group_membership_periods gmp
       ON gmp.group_id = gm.group_id
      AND gmp.user_id = gm.user_id
      AND gmp.ended_at IS NULL
     WHERE gmp.id IS NULL`
  );

  for (const member of activeMembers) {
    await run(
      db,
      `INSERT INTO group_membership_periods (id, group_id, user_id, started_at)
       VALUES (?, ?, ?, ?)`,
      [member.id, member.group_id, member.user_id, member.joined_at || new Date().toISOString()]
    );
  }
}

export async function ensureGroupMemberRoleColumn(db) {
  const columns = await all(db, 'PRAGMA table_info(group_members)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('role')) {
    await run(db, "ALTER TABLE group_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  }

  await run(
    db,
    `UPDATE group_members
     SET role = CASE
       WHEN user_id IN (SELECT admin_id FROM groups WHERE groups.id = group_members.group_id) THEN 'admin'
       WHEN role IS NULL OR role = '' THEN 'member'
       ELSE role
     END`
  );
}

export async function ensureGroupDeleteApprovalTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS group_delete_requests (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL UNIQUE,
      requested_by_user_id TEXT NOT NULL,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS group_delete_approvals (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES group_delete_requests(id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(request_id, user_id)
    )`
  );

  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_group_delete_requests_group_id ON group_delete_requests(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_request_id ON group_delete_approvals(request_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_group_id ON group_delete_approvals(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_user_id ON group_delete_approvals(user_id)'
  );
}

export async function ensureExpensePaymentAttachmentColumns(db) {
  for (const tableName of ['expenses', 'payments']) {
    const columns = await all(db, `PRAGMA table_info(${tableName})`);
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has('attachment_name')) {
      await run(db, `ALTER TABLE ${tableName} ADD COLUMN attachment_name TEXT`);
    }

    if (!columnNames.has('attachment_path')) {
      await run(db, `ALTER TABLE ${tableName} ADD COLUMN attachment_path TEXT`);
    }

    if (!columnNames.has('attachment_mime_type')) {
      await run(db, `ALTER TABLE ${tableName} ADD COLUMN attachment_mime_type TEXT`);
    }

    if (!columnNames.has('attachment_size')) {
      await run(db, `ALTER TABLE ${tableName} ADD COLUMN attachment_size INTEGER`);
    }
  }
}

export async function ensureInboxNotificationsTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS inbox_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      action_url TEXT,
      metadata_json TEXT,
      dedupe_key TEXT,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )`
  );

  const columns = await all(db, 'PRAGMA table_info(inbox_notifications)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('metadata_json')) {
    await run(db, 'ALTER TABLE inbox_notifications ADD COLUMN metadata_json TEXT');
  }

  if (!columnNames.has('dedupe_key')) {
    await run(db, 'ALTER TABLE inbox_notifications ADD COLUMN dedupe_key TEXT');
  }

  if (!columnNames.has('is_read')) {
    await run(db, 'ALTER TABLE inbox_notifications ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnNames.has('read_at')) {
    await run(db, 'ALTER TABLE inbox_notifications ADD COLUMN read_at DATETIME');
  }

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbox_notifications_user_id ON inbox_notifications(user_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbox_notifications_group_id ON inbox_notifications(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbox_notifications_is_read ON inbox_notifications(is_read)'
  );
  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_notifications_dedupe ON inbox_notifications(user_id, dedupe_key)'
  );
}

export async function ensureActivityLogsTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT,
      activity_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  const columns = await all(db, 'PRAGMA table_info(activity_logs)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('metadata_json')) {
    await run(db, 'ALTER TABLE activity_logs ADD COLUMN metadata_json TEXT');
  }

  await run(db, 'CREATE INDEX IF NOT EXISTS idx_activity_logs_group_id ON activity_logs(group_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(activity_type)');
}

export async function ensureRecurringTemplatesTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS recurring_templates (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('expense', 'payment')),
      title TEXT NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      note TEXT,
      payment_method TEXT CHECK(payment_method IN ('Cash', 'PayPal')),
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'monthly')),
      day_of_week INTEGER,
      day_of_month INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_recurring_templates_group_id ON recurring_templates(group_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_recurring_templates_user_id ON recurring_templates(user_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON recurring_templates(is_active)'
  );
}

export async function ensureUndoActionsTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS undo_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload_json TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      undone_at DATETIME,
      undone_by_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (undone_by_user_id) REFERENCES users(id)
    )`
  );

  await run(db, 'CREATE INDEX IF NOT EXISTS idx_undo_actions_user_id ON undo_actions(user_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_undo_actions_group_id ON undo_actions(group_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_undo_actions_expires_at ON undo_actions(expires_at)');
}
