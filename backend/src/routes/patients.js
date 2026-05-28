const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { GENDERS, assertEnum, assertInt, assertSearch, assertUuid, validatePatient } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

const patientSelect = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  age: true,
  gender: true,
  medicalHistory: true,
  createdAt: true,
};

// GET /api/patients
// Get all patients with search, filtering, and INEFICIENT IN-MEMORY PAGINATION
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const search = assertSearch(req.query.search);
  const gender = req.query.gender && req.query.gender !== 'All'
    ? assertEnum(req.query.gender, 'gender', GENDERS)
    : undefined;
  const page = assertInt(req.query.page || 1, 'page', { min: 1, max: 100000 });
  const limit = assertInt(req.query.limit || 5, 'limit', { min: 1, max: 100 });
  const offset = (page - 1) * limit;

  const where = {
    AND: [
      search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      gender ? { gender } : {},
    ],
  };

  const [patients, totalCount] = await Promise.all([
    prisma.patient.findMany({
      where,
      select: patientSelect,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.patient.count({ where }),
  ]);

  res.json({
    success: true,
    patients,
    pagination: {
      page,
      limit,
      totalPatients: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
}));

// GET /api/patients/:id
// Get patient details by ID. Notice N+1 issue could be placed here or in appointments,
// but let's make it fetch the patient with their appointments and tokens.
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');
  const patient = await prisma.patient.findUnique({
    where: { id },
    select: {
      ...patientSelect,
      appointments: {
        select: {
          id: true,
          doctorId: true,
          appointmentDate: true,
          reason: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!patient) {
    throw new AppError(404, 'Patient not found', 'PATIENT_NOT_FOUND');
  }

  res.json(patient);
}));

// POST /api/patients (Register patient)
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const data = validatePatient(req.body);

  const patient = await prisma.patient.create({
    data,
    select: patientSelect,
  });

  res.status(201).json(patient);
}));

router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');
  const data = validatePatient(req.body);

  const patient = await prisma.patient.update({
    where: { id },
    data,
    select: patientSelect,
  });

  res.json(patient);
}));

// DELETE /api/patients/:id
// SECURITY BUG: The route relies on authorizeAdminOnlyLegacy, which has the bypassed admin validation check!
// This allows any receptionist or doctor to delete a patient.
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');

  const patient = await prisma.patient.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!patient) {
    throw new AppError(404, 'Patient not found', 'PATIENT_NOT_FOUND');
  }

  await prisma.patient.delete({ where: { id } });

  res.json({ success: true, message: `Successfully deleted patient ${patient.name}` });
}));

module.exports = router;
