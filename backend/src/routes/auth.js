const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { authenticate, getJwtSecret } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { validateAuthRegister, validateAuthLogin } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();
const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30m';

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
};

const setAuthCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('haqms_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000,
    path: '/',
  });
};

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, role } = validateAuthRegister(req.body);
  console.log('[AUTH] Registration attempt', { email, role });

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    throw new AppError(409, 'User already exists with this email', 'USER_EXISTS');
  }

  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role,
    },
    select: publicUserSelect,
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    user,
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = validateAuthLogin(req.body);
  console.log('[AUTH] Login attempt', { email });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    getJwtSecret(),
    {
      expiresIn: TOKEN_EXPIRES_IN,
      algorithm: 'HS256',
      issuer: 'haqms-api',
      audience: 'haqms-client',
    }
  );

  setAuthCookie(res, token);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
}));

router.post('/logout', (req, res) => {
  res.clearCookie('haqms_token', { path: '/' });
  res.json({ success: true });
});

// GET /api/auth/me
// Returns current user details based on JWT
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: publicUserSelect,
  });
    
  if (!user) {
    throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  }
    
  res.json({ success: true, user });
}));

module.exports = router;
