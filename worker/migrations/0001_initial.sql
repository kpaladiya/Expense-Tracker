PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (instr(email, '@') > 1),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
  onboarding_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE token_revocations (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  is_disabled INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0, 1)),
  disabled_at TEXT,
  disabled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  admin_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'co_admin', 'manager', 'member')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, user_id)
);

CREATE TABLE group_join_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending_user', 'pending_admin', 'approved', 'declined_by_user', 'rejected_by_admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT
);
CREATE UNIQUE INDEX group_join_requests_one_open
  ON group_join_requests(group_id, invited_user_id)
  WHERE status IN ('pending_user', 'pending_admin');

CREATE TABLE group_delete_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE group_delete_approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES group_delete_requests(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, user_id)
);

CREATE TABLE group_membership_periods (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  removal_reason TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX membership_one_active
  ON group_membership_periods(group_id, user_id) WHERE ended_at IS NULL;

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  expense_date TEXT NOT NULL CHECK (date(expense_date) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'PayPal')),
  customer_note TEXT NOT NULL DEFAULT '',
  payment_date TEXT NOT NULL CHECK (date(payment_date) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settled_months (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  settled_by_user_id TEXT NOT NULL REFERENCES users(id),
  settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, month)
);

CREATE TABLE inbox_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  metadata_json TEXT,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX inbox_dedupe ON inbox_notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_templates (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('expense', 'payment')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  amount REAL NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('Cash', 'PayPal')),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((frequency = 'weekly' AND day_of_week IS NOT NULL AND day_of_month IS NULL)
      OR (frequency = 'monthly' AND day_of_month IS NOT NULL AND day_of_week IS NULL))
);

CREATE TABLE undo_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  undone_at TEXT,
  undone_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE feedback_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'help', 'general')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  ticket_number TEXT NOT NULL UNIQUE,
  terms_accepted INTEGER NOT NULL CHECK (terms_accepted = 1),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX expenses_group_date ON expenses(group_id, expense_date DESC);
CREATE INDEX payments_group_date ON payments(group_id, payment_date DESC);
CREATE INDEX group_members_user ON group_members(user_id);
CREATE INDEX activity_group_created ON activity_logs(group_id, created_at DESC);
CREATE INDEX inbox_user_created ON inbox_notifications(user_id, created_at DESC);
CREATE INDEX templates_group_active ON recurring_templates(group_id, is_active);
CREATE INDEX undo_user_created ON undo_actions(user_id, created_at DESC);

CREATE TRIGGER users_updated_at AFTER UPDATE ON users BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TRIGGER groups_updated_at AFTER UPDATE ON groups BEGIN
  UPDATE groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TRIGGER expenses_updated_at AFTER UPDATE ON expenses BEGIN
  UPDATE expenses SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TRIGGER payments_updated_at AFTER UPDATE ON payments BEGIN
  UPDATE payments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TRIGGER templates_updated_at AFTER UPDATE ON recurring_templates BEGIN
  UPDATE recurring_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
