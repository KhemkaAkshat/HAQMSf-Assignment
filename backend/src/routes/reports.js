const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/doctor-stats', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const start = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [doctors, appointmentGroups, queueGroups] = await Promise.all([
    prisma.doctor.findMany({
      select: {
        id: true,
        name: true,
        specialization: true,
        department: true,
        consultationFee: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.appointment.groupBy({
      by: ['doctorId', 'status'],
      _count: {
        _all: true,
      },
    }),
    prisma.queueToken.groupBy({
      by: ['doctorId'],
      where: {
        tokenDate: today,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const statsByDoctor = new Map();
  for (const group of appointmentGroups) {
    const current = statsByDoctor.get(group.doctorId) || {
      totalAppointments: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
    };
    const count = group._count._all;
    current.totalAppointments += count;
    if (group.status === 'COMPLETED') current.completedAppointments = count;
    if (group.status === 'CANCELLED') current.cancelledAppointments = count;
    statsByDoctor.set(group.doctorId, current);
  }

  const queueCountByDoctor = new Map(
    queueGroups.map((group) => [group.doctorId, group._count._all])
  );

  const reportData = doctors.map((doc) => {
    const appointmentStats = statsByDoctor.get(doc.id) || {
      totalAppointments: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
    };

    return {
      id: doc.id,
      name: doc.name,
      specialization: doc.specialization,
      department: doc.department,
      totalAppointments: appointmentStats.totalAppointments,
      completedAppointments: appointmentStats.completedAppointments,
      cancelledAppointments: appointmentStats.cancelledAppointments,
      todayQueueSize: queueCountByDoctor.get(doc.id) || 0,
      revenue: appointmentStats.completedAppointments * doc.consultationFee,
    };
  });

  const durationMs = Date.now() - start;

  res.json({
    success: true,
    timeTakenMs: durationMs,
    data: reportData,
  });
}));

module.exports = router;
