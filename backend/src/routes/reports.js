const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get('/doctor-stats', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const start = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const doctors = await prisma.doctor.findMany({
    select: {
      id: true,
      name: true,
      specialization: true,
      department: true,
      consultationFee: true,
      appointments: {
        select: {
          status: true,
        },
      },
      queueTokens: {
        where: {
          createdAt: { gte: today },
        },
        select: {
          id: true,
        },
      },
    },
  });

  const reportData = doctors.map((doc) => {
    const completedAppointments = doc.appointments.filter((appointment) => appointment.status === 'COMPLETED').length;
    const cancelledAppointments = doc.appointments.filter((appointment) => appointment.status === 'CANCELLED').length;

    return {
      id: doc.id,
      name: doc.name,
      specialization: doc.specialization,
      department: doc.department,
      totalAppointments: doc.appointments.length,
      completedAppointments,
      cancelledAppointments,
      todayQueueSize: doc.queueTokens.length,
      revenue: completedAppointments * doc.consultationFee,
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
