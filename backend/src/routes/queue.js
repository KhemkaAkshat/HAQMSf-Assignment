const express = require('express');
const { Prisma, PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { QUEUE_STATUSES, assertEnum, assertUuid, validateQueueCheckin, validateQueueStatus } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

const tokenInclude = {
  patient: {
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      age: true,
      gender: true,
      medicalHistory: true,
    },
  },
  doctor: {
    select: {
      id: true,
      name: true,
      specialization: true,
      department: true,
    },
  },
};

const isRetryableTokenConflict = (error) => (
  error.code === 'P2002' || error.code === 'P2034'
);

const createQueueTokenWithRetry = async ({ patientId, doctorId, appointmentId, tokenDate }) => {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const maxTokenResult = await tx.queueToken.aggregate({
          where: {
            doctorId,
            tokenDate,
          },
          _max: {
            tokenNumber: true,
          },
        });

        const nextTokenNumber = (maxTokenResult._max.tokenNumber || 0) + 1;

        return tx.queueToken.create({
          data: {
            tokenNumber: nextTokenNumber,
            patientId,
            doctorId,
            appointmentId,
            tokenDate,
            status: 'WAITING',
          },
          include: tokenInclude,
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTokenConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }
};

// GET /api/queue
// List all active queue tokens
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.doctorId) where.doctorId = assertUuid(req.query.doctorId, 'doctorId');
  if (req.query.status) where.status = assertEnum(req.query.status, 'status', QUEUE_STATUSES);

  const tokens = await prisma.queueToken.findMany({
    where,
    include: tokenInclude,
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    success: true,
    count: tokens.length,
    data: tokens,
  });
}));

// POST /api/queue/checkin
// Generate a new queue token with serializable retry and DB-backed daily uniqueness.
router.post('/checkin', authenticate, asyncHandler(async (req, res) => {
  const { patientId, doctorId, appointmentId } = validateQueueCheckin(req.body);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const newToken = await createQueueTokenWithRetry({
    patientId,
    doctorId,
    appointmentId,
    tokenDate: today,
  });

  res.status(201).json({
    success: true,
    message: 'Checked in successfully. Token generated.',
    token: newToken,
  });
}));

// PATCH /api/queue/:id
// Update token status (WAITING -> CALLING -> COMPLETED / SKIPPED)
router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');
  const { status } = validateQueueStatus(req.body);

  const updatedToken = await prisma.queueToken.update({
    where: { id },
    data: { status },
    include: tokenInclude,
  });

  res.json({ success: true, token: updatedToken });
}));

module.exports = router;
