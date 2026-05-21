import jwt from 'jsonwebtoken';

/**
 * Middleware to verify JWT token
 * Adds user data to req.user if token is valid
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secret-key');
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

/**
 * Middleware to check if user is admin
 * Must be used after authenticateToken
 */
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
}

/**
 * Middleware to check if user is group admin
 * Verifies user is admin of the specific group
 */
export function requireGroupAdmin(req, res, next) {
  // This will be implemented in the actual group routes
  // to check if req.user.id is the admin of req.params.groupId
  next();
}