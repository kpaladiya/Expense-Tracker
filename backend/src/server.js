import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import activityRoutes from './routes/activity.js';
import groupRoutes from './routes/groups.js';
import expenseRoutes from './routes/expenses.js';
import inboxRoutes from './routes/inbox.js';
import paymentRoutes from './routes/payments.js';
import recurringRoutes from './routes/recurring.js';
import reportsRoutes from './routes/reports.js';
import settlementRoutes from './routes/settlement.js';
import supportRoutes from './routes/support.js';
import undoRoutes from './routes/undo.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use('/uploads', express.static(uploadsDir));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settlement', settlementRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/undo', undoRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('Initializing database...');
    await initializeDb();
    console.log('Database ready ✓');
    if (process.env.NODE_ENV !== 'production') {
      console.log('🧪 Dev login: demo@sharedexpenses.local / demo1234');
    }

    app.listen(PORT, () => {
      console.log(`\n✅ Server running on http://localhost:${PORT}`);
      console.log(`📝 Frontend should be configured to use this URL`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();