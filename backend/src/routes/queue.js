const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { QUEUE_STATUSES, assertEnum, assertUuid, validateQueueCheckin, validateQueueStatus } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/queue
// List all active queue tokens
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.doctorId) where.doctorId = assertUuid(req.query.doctorId, 'doctorId');
  if (req.query.status) where.status = assertEnum(req.query.status, 'status', QUEUE_STATUSES);

  const tokens = await prisma.queueToken.findMany({
    where,
    include: {
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
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json(tokens);
}));

// POST /api/queue/checkin
// Generate a new queue token for a patient
// CONCURRENCY/RACE CONDITION BUG: Token increment uses aggregate read followed by create.
// Introduce a deliberate asynchronous delay (setTimeout) to force a wide race window
// where concurrent check-ins assign the exact same token number.
router.post('/checkin', authenticate, asyncHandler(async (req, res) => {
  const { patientId, doctorId, appointmentId } = validateQueueCheckin(req.body);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const newToken = await prisma.$transaction(async (tx) => {
    const maxTokenResult = await tx.queueToken.aggregate({
      where: {
        doctorId,
        createdAt: { gte: today },
      },
      _max: {
        tokenNumber: true,
      },
    });

    const currentMax = maxTokenResult._max.tokenNumber || 0;
    const nextTokenNumber = currentMax + 1;

    return tx.queueToken.create({
      data: {
        tokenNumber: nextTokenNumber,
        patientId,
        doctorId,
        appointmentId: appointmentId || null,
        status: 'WAITING',
      },
      include: {
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
      },
    });
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
    include: {
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
    },
  });

  res.json(updatedToken);
}));

module.exports = router;
