import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { get, run } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendActivationEmail } from '../utils/email.js';

const router = express.Router();
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getJwtSecret() {
  return process.env.JWT_SECRET || 'secret-key';
}

function getJwtExpire() {
  return process.env.JWT_EXPIRE || '7d';
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function createVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createAndSendVerificationEmail({ userId, email, name, passwordHash, isAdmin = 0 }) {
  const token = createVerificationToken();
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS).toISOString();

  const existingUser = await get(
    'SELECT id FROM users WHERE id = ?',
    [userId]
  );

  if (existingUser) {
    await run(
      `UPDATE users
       SET email = ?, password_hash = ?, name = ?, is_admin = ?, email_verified = 0,
           email_verification_token = ?, email_verification_expires_at = ?, email_verification_sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [email, passwordHash, name, isAdmin, token, expiresAt, userId]
    );
  } else {
    await run(
      `INSERT INTO users (
         id, email, password_hash, name, is_admin, email_verified,
         email_verification_token, email_verification_expires_at, email_verification_sent_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, email, passwordHash, name, isAdmin, token, expiresAt]
    );
  }

  await sendActivationEmail({ email, name, token });
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and name are required'
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const existingUser = await get(
      'SELECT id, email_verified FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (existingUser && existingUser.email_verified === 1) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = existingUser?.id || uuidv4();

    await createAndSendVerificationEmail({
      userId,
      email: normalizedEmail,
      name: name.trim(),
      passwordHash
    });

    res.status(201).json({
      success: true,
      message: 'Registration created. Check your email to activate your account.'
    });
  } catch (error) {
    console.error('Register error:', error);

    const isEmailConfigError =
      error.message === 'Email delivery is not configured. Update SMTP settings in backend/.env.' ||
      error.message?.startsWith('Missing required email configuration:') ||
      error.message === 'SMTP_USER and SMTP_PASS must both be set when using authenticated SMTP';

    res.status(500).json({
      success: false,
      error: isEmailConfigError
        ? 'Email delivery is not configured. Update SMTP settings in backend/.env.'
        : 'Failed to register user'
    });
  }
});

router.post('/activate', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Activation token is required'
      });
    }

    const user = await get(
      `SELECT id, email_verification_expires_at
       FROM users
       WHERE email_verification_token = ?`,
      [token]
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid activation link'
      });
    }

    if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        error: 'Activation link expired. Register again to receive a new email.'
      });
    }

    await run(
      `UPDATE users
       SET email_verified = 1,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id]
    );

    res.json({
      success: true,
      message: 'Email verified successfully. You can now log in.'
    });
  } catch (error) {
    console.error('Activate error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to activate account'
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await get(
      'SELECT id, email, name, password_hash, is_admin, email_verified FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    if (user.email_verified !== 1) {
      return res.status(403).json({
        success: false,
        error: 'Please activate your email before logging in'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin === 1
      },
      getJwtSecret(),
      { expiresIn: getJwtExpire() }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin === 1,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login'
    });
  }
});

router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await get(
      'SELECT id, email, name, is_admin FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin === 1
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user info'
    });
  }
});

export default router;
