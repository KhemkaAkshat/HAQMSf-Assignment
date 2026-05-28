const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { assertSearch, assertUuid } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

const doctorSelect = {
  id: true,
  userId: true,
  name: true,
  specialization: true,
  department: true,
  consultationFee: true,
  experience: true,
  availableFrom: true,
  availableTo: true,
  createdAt: true,
};

// GET /api/doctors
// Retrieve list of doctors with validated Prisma search filtering.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const search = assertSearch(req.query.search);
  const specialization = req.query.specialization && req.query.specialization !== 'All'
    ? assertSearch(req.query.specialization, 'specialization')
    : undefined;

  const doctors = await prisma.doctor.findMany({
    where: {
      AND: [
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { department: { contains: search, mode: 'insensitive' } },
                { specialization: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        specialization ? { specialization } : {},
      ],
    },
    select: doctorSelect,
    orderBy: { name: 'asc' },
  });

  res.json({
    success: true,
    count: doctors.length,
    data: doctors,
  });
}));

// GET /api/doctors/stats
// Returns aggregation details about available doctors
// PERFORMANCE BUG: Sequential async calls instead of Promise.all()
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const start = Date.now();

  const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
    prisma.doctor.count(),
    prisma.doctor.count({
      where: { department: 'Surgery' },
    }),
    prisma.doctor.aggregate({
      _avg: {
        consultationFee: true,
      },
    }),
    prisma.doctor.aggregate({
      _max: {
        experience: true,
      },
    }),
  ]);

  const durationMs = Date.now() - start;

  res.json({
    success: true,
    data: {
      total: totalDoctors,
      surgeons: surgeonsCount,
      averageFee: Math.round(averageFee._avg.consultationFee || 0),
      maxExperience: highestExperience._max.experience || 0,
    },
    debugInfo: {
      executionTimeMs: durationMs,
    },
  });
}));

// GET /api/doctors/:id
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');
  const doctor = await prisma.doctor.findUnique({
    where: { id },
    select: doctorSelect,
  });

  if (!doctor) {
    throw new AppError(404, 'Doctor not found', 'DOCTOR_NOT_FOUND');
  }

  res.json(doctor);
}));

module.exports = router;
