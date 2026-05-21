-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
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
  admin_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

-- Group Members Table
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
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
  payment_date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_group_id ON payments(group_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_id ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_invited_user_id ON group_join_requests(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_status ON group_join_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);
