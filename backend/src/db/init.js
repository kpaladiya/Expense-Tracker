import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { ensureUserVerificationColumns } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Execute schema
db.exec(schema, async (err) => {
  if (err) {
    console.error('Error executing schema:', err);
    process.exit(1);
  }

  console.log('✓ Database schema created');

  try {
    await ensureUserVerificationColumns(db);
  } catch (migrationError) {
    console.error('Error migrating users table:', migrationError);
    process.exit(1);
  }

  // Check if demo data already exists
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
      console.error('Error checking users:', err);
      process.exit(1);
    }

    if (row.count > 0) {
      console.log('✓ Demo data already exists, skipping seed');
      db.close();
      console.log('\n✅ Database initialized successfully!');
      console.log('\nDefault credentials:');
      console.log('  Admin: admin@example.com / admin123');
      console.log('  User A: usera@example.com / password123');
      console.log('  User B: userb@example.com / password123');
      console.log('  User C: userc@example.com / password123');
      return;
    }

    // Seed demo data
    seedDatabase();
  });
});

function seedDatabase() {
  const users = [
    {
      id: uuidv4(),
      email: 'admin@example.com',
      password: 'admin123',
      name: 'Admin User',
      is_admin: 1
    },
    {
      id: uuidv4(),
      email: 'usera@example.com',
      password: 'password123',
      name: 'User A',
      is_admin: 0
    },
    {
      id: uuidv4(),
      email: 'userb@example.com',
      password: 'password123',
      name: 'User B',
      is_admin: 0
    },
    {
      id: uuidv4(),
      email: 'userc@example.com',
      password: 'password123',
      name: 'User C',
      is_admin: 0
    }
  ];

  // Hash passwords and insert users
  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, is_admin, email_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  users.forEach((user) => {
    const hash = bcrypt.hashSync(user.password, 10);
    stmt.run(user.id, user.email, hash, user.name, user.is_admin, 1);
  });

  stmt.finalize();
  console.log('✓ Users created');

  // Create group
  const adminId = users[0].id;
  const groupId = uuidv4();
  
  db.run(
    `INSERT INTO groups (id, name, description, admin_id)
     VALUES (?, ?, ?, ?)`,
    [groupId, 'Tech Startup', 'Sample startup group for testing', adminId],
    (err) => {
      if (err) {
        console.error('Error creating group:', err);
        process.exit(1);
      }
      console.log('✓ Group created');

      // Add members to group
      const memberStmt = db.prepare(`
        INSERT INTO group_members (id, group_id, user_id)
        VALUES (?, ?, ?)
      `);

      users.forEach((user) => {
        memberStmt.run(uuidv4(), groupId, user.id);
      });

      memberStmt.finalize();
      console.log('✓ Members added to group');

      // Add sample expenses
      const expenses = [
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[1].id, // User A
          amount: 100,
          note: 'Office supplies',
          expense_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        },
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[1].id, // User A
          amount: 80,
          note: 'Domain renewal',
          expense_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        },
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[2].id, // User B
          amount: 50,
          note: 'Server hosting',
          expense_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      ];

      const expenseStmt = db.prepare(`
        INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      expenses.forEach((expense) => {
        expenseStmt.run(
          expense.id,
          expense.group_id,
          expense.user_id,
          expense.amount,
          expense.note,
          expense.expense_date
        );
      });

      expenseStmt.finalize();
      console.log('✓ Sample expenses added');

      // Add sample payments
      const payments = [
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[1].id, // User A
          amount: 300,
          payment_method: 'Cash',
          customer_note: 'Web design project',
          payment_date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        },
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[2].id, // User B
          amount: 200,
          payment_method: 'PayPal',
          customer_note: 'Consulting session',
          payment_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        },
        {
          id: uuidv4(),
          group_id: groupId,
          user_id: users[3].id, // User C
          amount: 150,
          payment_method: 'Cash',
          customer_note: 'Event management',
          payment_date: new Date().toISOString().split('T')[0]
        }
      ];

      const paymentStmt = db.prepare(`
        INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      payments.forEach((payment) => {
        paymentStmt.run(
          payment.id,
          payment.group_id,
          payment.user_id,
          payment.amount,
          payment.payment_method,
          payment.customer_note,
          payment.payment_date
        );
      });

      paymentStmt.finalize();
      console.log('✓ Sample payments added');

      db.close();
      console.log('\n✅ Database initialized successfully!');
      console.log('\nDefault credentials:');
      console.log('  Admin: admin@example.com / admin123');
      console.log('  User A: usera@example.com / password123');
      console.log('  User B: userb@example.com / password123');
      console.log('  User C: userc@example.com / password123');
      console.log('\nSample data has been loaded.');
      console.log('Group: "Tech Startup" with 4 members');
      console.log('Sample expenses and payments ready to view.');
    }
  );
}
