const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }

  if (!global.__HAQMS_DEV_JWT_SECRET__) {
    global.__HAQMS_DEV_JWT_SECRET__ = crypto.randomBytes(48).toString('hex');
    console.warn('[AUTH] JWT_SECRET missing; using a volatile development-only secret.');
  }

  return global.__HAQMS_DEV_JWT_SECRET__;
};

const getCookieValue = (cookieHeader, name) => {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;
  const usableBearerToken = bearerToken && !['null', 'undefined', ''].includes(bearerToken)
    ? bearerToken
    : null;
  const token = usableBearerToken || getCookieValue(req.headers.cookie, 'haqms_token');

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'UNAUTHORIZED' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'haqms-api',
      audience: 'haqms-client',
    });
    
    // Add user details to request object
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
};

// Role authorization middleware
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    // Role-based verification
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient role privileges', code: 'FORBIDDEN' });
    }

    next();
  };
};

const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'UNAUTHORIZED' });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Admin role required', code: 'FORBIDDEN' });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  authorizeAdminOnlyLegacy,
  getJwtSecret,
};
