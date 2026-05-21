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
