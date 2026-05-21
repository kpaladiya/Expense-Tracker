import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
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

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID;
}

function createGoogleClient() {
  const clientId = getGoogleClientId();

  if (!clientId) {
    throw new Error('Google sign-in is not configured. Set GOOGLE_CLIENT_ID in backend/.env.');
  }

  return new OAuth2Client(clientId);
}

function buildAuthPayload(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin === 1
  };
}

function buildUserData(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin === 1,
    googleLinked: Boolean(user.google_id)
  };
}

function createAuthResponse(user, message = 'Login successful') {
  const authData = buildAuthPayload(user);
  const userData = buildUserData(user);
  const token = jwt.sign(authData, getJwtSecret(), { expiresIn: getJwtExpire() });

  return {
    success: true,
    message,
    data: {
      ...userData,
      token
    }
  };
}

function createGooglePasswordHash() {
  return bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
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

async function findUserByGoogleIdentity(googleId, email) {
  const userByGoogleId = await get(
    'SELECT id, email, name, password_hash, is_admin, email_verified, google_id FROM users WHERE google_id = ?',
    [googleId]
  );

  if (userByGoogleId) {
    return userByGoogleId;
  }

  return get(
    'SELECT id, email, name, password_hash, is_admin, email_verified, google_id FROM users WHERE email = ?',
    [email]
  );
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
      'SELECT id, name, email_verified, google_id FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (existingUser && existingUser.email_verified === 1 && !existingUser.google_id) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    if (existingUser && existingUser.email_verified === 1 && existingUser.google_id) {
      await run(
        `UPDATE users
         SET password_hash = ?,
             name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [passwordHash, name.trim() || existingUser.name, existingUser.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Password login enabled. You can now sign in with email and password.'
      });
    }

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
      'SELECT id, email, name, password_hash, is_admin, email_verified, google_id FROM users WHERE email = ?',
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

    res.json(createAuthResponse(user));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login'
    });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        error: 'Google credential is required'
      });
    }

    const googleClient = createGoogleClient();
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: getGoogleClientId()
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google account data'
      });
    }

    if (payload.email_verified !== true) {
      return res.status(403).json({
        success: false,
        error: 'Google account email is not verified'
      });
    }

    const normalizedEmail = normalizeEmail(payload.email);
    const displayName = payload.name?.trim() || normalizedEmail.split('@')[0];
    const existingUser = await findUserByGoogleIdentity(payload.sub, normalizedEmail);

    if (existingUser?.google_id && existingUser.google_id !== payload.sub) {
      return res.status(409).json({
        success: false,
        error: 'This email is already linked to a different Google account'
      });
    }

    if (!existingUser) {
      const newUser = {
        id: uuidv4(),
        email: normalizedEmail,
        name: displayName,
        is_admin: 0,
        google_id: payload.sub
      };

      await run(
        `INSERT INTO users (
           id, email, google_id, password_hash, name, is_admin, email_verified
         ) VALUES (?, ?, ?, ?, ?, 0, 1)`,
        [newUser.id, newUser.email, payload.sub, createGooglePasswordHash(), newUser.name]
      );

      return res.json(createAuthResponse(newUser, 'Google login successful'));
    }

    await run(
      `UPDATE users
       SET google_id = ?,
           email_verified = 1,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           name = CASE WHEN TRIM(COALESCE(name, '')) = '' THEN ? ELSE name END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [payload.sub, displayName, existingUser.id]
    );

    const user = await get(
      'SELECT id, email, name, is_admin FROM users WHERE id = ?',
      [existingUser.id]
    );

    res.json(createAuthResponse(user, 'Google login successful'));
  } catch (error) {
    console.error('Google login error:', error);

    const isGoogleConfigError = error.message === 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID in backend/.env.';

    res.status(isGoogleConfigError ? 500 : 401).json({
      success: false,
      error: isGoogleConfigError
        ? error.message
        : 'Google sign-in failed'
    });
  }
});

router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, password } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const trimmedName = name.trim();

      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          error: 'Name cannot be empty'
        });
      }

      updates.push('name = ?');
      params.push(trimmedName);
    }

    if (password !== undefined) {
      if (!password || password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }

      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Provide a name or password to update'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await run(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = ?`,
      [...params, req.user.id]
    );

    const user = await get(
      'SELECT id, email, name, is_admin, google_id FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json(createAuthResponse(user, 'Profile updated successfully'));
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await get(
      'SELECT id, email, name, is_admin, google_id FROM users WHERE id = ?',
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
      data: buildUserData(user)
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
