-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  google_id TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK(onboarding_completed IN (0, 1)),
  onboarding_seen_at DATETIME,
  email_verified INTEGER DEFAULT 0,
  email_verification_token TEXT,
  email_verification_expires_at DATETIME,
  email_verification_sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Groups Table (Teams/Businesses)
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  is_disabled INTEGER NOT NULL DEFAULT 0 CHECK(is_disabled IN (0, 1)),
  disabled_at DATETIME,
  disabled_by_user_id TEXT,
  admin_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id),
  FOREIGN KEY (disabled_by_user_id) REFERENCES users(id)
);

-- Group Members Table
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'co_admin', 'manager', 'member')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(group_id, user_id)
);

-- Group Join Requests Table
CREATE TABLE IF NOT EXISTS group_join_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  invited_user_id TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'pending_user',
    'pending_admin',
    'approved',
    'declined_by_user',
    'rejected_by_admin'
  )),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (invited_user_id) REFERENCES users(id),
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

-- Expenses Table (Personal spending for business)
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  note TEXT,
  attachment_name TEXT,
  attachment_path TEXT,
  attachment_mime_type TEXT,
  attachment_size INTEGER,
  expense_date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Payments Table (Money received from customers)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_method TEXT CHECK(payment_method IN ('Cash', 'PayPal')) NOT NULL,
  customer_note TEXT,
  attachment_name TEXT,
  attachment_path TEXT,
  attachment_mime_type TEXT,
  attachment_size INTEGER,
  payment_date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Settled Months Table (closed accounting periods per group)
CREATE TABLE IF NOT EXISTS settled_months (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  settled_by_user_id TEXT NOT NULL,
  settled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (settled_by_user_id) REFERENCES users(id),
  UNIQUE(group_id, month)
);

-- Member removals audit trail
CREATE TABLE IF NOT EXISTS member_removals (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  removed_user_id TEXT NOT NULL,
  removed_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (removed_user_id) REFERENCES users(id),
  FOREIGN KEY (removed_by_user_id) REFERENCES users(id)
);

-- Membership periods for settlement calculations
CREATE TABLE IF NOT EXISTS group_membership_periods (
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
);

-- Group deletion approval workflow
CREATE TABLE IF NOT EXISTS group_delete_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE,
  requested_by_user_id TEXT NOT NULL,
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_delete_approvals (
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
);

-- Feedback submissions
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('bug', 'feature', 'help', 'general')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  ticket_number TEXT UNIQUE NOT NULL,
  terms_accepted INTEGER NOT NULL DEFAULT 0 CHECK(terms_accepted IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'closed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- In-app inbox notifications
CREATE TABLE IF NOT EXISTS inbox_notifications (
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
);

-- Group activity timeline
CREATE TABLE IF NOT EXISTS activity_logs (
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
);

-- Recurring templates for repeated entries
CREATE TABLE IF NOT EXISTS recurring_templates (
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
);

-- Recent undo actions
CREATE TABLE IF NOT EXISTS undo_actions (
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
);

-- Create Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_group_id ON payments(group_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_settled_months_group_id ON settled_months(group_id);
CREATE INDEX IF NOT EXISTS idx_settled_months_month ON settled_months(month);
CREATE INDEX IF NOT EXISTS idx_member_removals_group_id ON member_removals(group_id);
CREATE INDEX IF NOT EXISTS idx_member_removals_removed_user_id ON member_removals(removed_user_id);
CREATE INDEX IF NOT EXISTS idx_group_membership_periods_group_id ON group_membership_periods(group_id);
CREATE INDEX IF NOT EXISTS idx_group_membership_periods_user_id ON group_membership_periods(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_delete_requests_group_id ON group_delete_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_request_id ON group_delete_approvals(request_id);
CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_group_id ON group_delete_approvals(group_id);
CREATE INDEX IF NOT EXISTS idx_group_delete_approvals_user_id ON group_delete_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_id ON feedback_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_category ON feedback_submissions(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_submissions_ticket_number ON feedback_submissions(ticket_number);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_user_id ON inbox_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_group_id ON inbox_notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_is_read ON inbox_notifications(is_read);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_notifications_dedupe ON inbox_notifications(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_activity_logs_group_id ON activity_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_group_id ON recurring_templates(group_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_user_id ON recurring_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON recurring_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_undo_actions_user_id ON undo_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_undo_actions_group_id ON undo_actions(group_id);
CREATE INDEX IF NOT EXISTS idx_undo_actions_expires_at ON undo_actions(expires_at);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_id ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_invited_user_id ON group_join_requests(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_status ON group_join_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);
