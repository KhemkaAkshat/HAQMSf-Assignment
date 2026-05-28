const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { APPOINTMENT_STATUSES, assertEnum, assertUuid, validateAppointment, validateAppointmentStatus } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/appointments
// List all appointments
// PERFORMANCE BUG: Classic N+1 Query Issue!
// Instead of using Prisma's include, it loops through each appointment and executes
// individual select statements for Patient and Doctor details.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.doctorId) where.doctorId = assertUuid(req.query.doctorId, 'doctorId');
  if (req.query.status) where.status = assertEnum(req.query.status, 'status', APPOINTMENT_STATUSES);

  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: { appointmentDate: 'asc' },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          age: true,
          medicalHistory: true,
        },
      },
      doctor: {
        select: {
          id: true,
          name: true,
          specialization: true,
        },
      },
    },
  });

  res.json({
    success: true,
    count: appointments.length,
    appointments,
  });
}));

// POST /api/appointments
// Book an appointment
// DESIGN BUG: Duplicate-prone schema. No unique index blocks duplicate appointment bookings.
// In this API, we have a half-hearted verification that is easily bypassed or logically flawed,
// allowing multiple bookings for the exact same date and doctor.
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { patientId, doctorId, appointmentDate, reason } = validateAppointment(req.body);

  const existingBooking = await prisma.appointment.findFirst({
    where: {
      doctorId,
      appointmentDate,
      status: { not: 'CANCELLED' },
    },
    select: { id: true },
  });

  if (existingBooking) {
    throw new AppError(409, 'Doctor already has an appointment at that time', 'APPOINTMENT_CONFLICT');
  }

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      doctorId,
      appointmentDate,
      reason,
      status: 'PENDING',
    },
  });

  res.status(201).json({
    success: true,
    message: 'Appointment booked successfully',
    appointment,
  });
}));

// PATCH /api/appointments/:id
// Update appointment status (COMPLETED, CANCELLED, etc.)
router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = assertUuid(req.params.id, 'id');
  const { status } = validateAppointmentStatus(req.body);

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status },
  });

  res.json(updated);
}));

module.exports = router;
