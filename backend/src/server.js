import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import expenseRoutes from './routes/expenses.js';
import paymentRoutes from './routes/payments.js';
import settlementRoutes from './routes/settlement.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Middleware
app.use(express.json());
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/settlement', settlementRoutes);

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