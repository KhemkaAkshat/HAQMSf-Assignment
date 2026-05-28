const { AppError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_RE = /^[0-9+\-()\s]{7,20}$/;

const ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST'];
const GENDERS = ['Male', 'Female', 'Other'];
const APPOINTMENT_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'];
const QUEUE_STATUSES = ['WAITING', 'CALLING', 'COMPLETED', 'SKIPPED'];

const fail = (message, field = undefined) => {
  const error = new AppError(400, message, 'VALIDATION_ERROR');
  if (field) error.field = field;
  throw error;
};

const assertString = (value, field, { min = 1, max = 255, optional = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    fail(`${field} is required`, field);
  }
  if (typeof value !== 'string') fail(`${field} must be a string`, field);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(`${field} must be between ${min} and ${max} characters`, field);
  }
  return trimmed;
};

const assertEmail = (value, field = 'email', { optional = false } = {}) => {
  const email = assertString(value, field, { min: 3, max: 254, optional });
  if (email === undefined) return undefined;
  if (!EMAIL_RE.test(email)) fail(`${field} must be a valid email address`, field);
  return email.toLowerCase();
};

const assertPassword = (value) => {
  const password = assertString(value, 'password', { min: 8, max: 128 });
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    fail('password must include at least one letter and one number', 'password');
  }
  return password;
};

const assertEnum = (value, field, values, { optional = false } = {}) => {
  const input = assertString(value, field, { min: 1, max: 40, optional });
  if (input === undefined) return undefined;
  if (!values.includes(input)) fail(`${field} is invalid`, field);
  return input;
};

const assertUuid = (value, field, { optional = false } = {}) => {
  const input = assertString(value, field, { min: 36, max: 36, optional });
  if (input === undefined) return undefined;
  if (!UUID_RE.test(input)) fail(`${field} must be a valid UUID`, field);
  return input;
};

const assertInt = (value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`${field} must be an integer between ${min} and ${max}`, field);
  }
  return number;
};

const assertDate = (value, field) => {
  const input = assertString(value, field, { min: 1, max: 80 });
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) fail(`${field} must be a valid date`, field);
  return date;
};

const assertSearch = (value, field = 'search') => {
  if (value === undefined || value === null || value === '') return undefined;
  return assertString(value, field, { min: 1, max: 100 });
};

const validateAuthRegister = (body) => ({
  email: assertEmail(body.email),
  password: assertPassword(body.password),
  name: assertString(body.name, 'name', { min: 2, max: 120 }),
  role: assertEnum(body.role || 'RECEPTIONIST', 'role', ROLES),
});

const validateAuthLogin = (body) => ({
  email: assertEmail(body.email),
  password: assertString(body.password, 'password', { min: 1, max: 128 }),
});

const validatePatient = (body) => ({
  name: assertString(body.name, 'name', { min: 2, max: 120 }),
  email: assertEmail(body.email, 'email', { optional: true }) || null,
  phoneNumber: (() => {
    const phone = assertString(body.phoneNumber, 'phoneNumber', { min: 7, max: 20 });
    if (!PHONE_RE.test(phone)) fail('phoneNumber format is invalid', 'phoneNumber');
    return phone;
  })(),
  age: assertInt(body.age, 'age', { min: 0, max: 130 }),
  gender: assertEnum(body.gender, 'gender', GENDERS),
  medicalHistory: assertString(body.medicalHistory, 'medicalHistory', { min: 0, max: 2000, optional: true }) || null,
});

const validateAppointment = (body) => ({
  patientId: assertUuid(body.patientId, 'patientId'),
  doctorId: assertUuid(body.doctorId, 'doctorId'),
  appointmentDate: assertDate(body.appointmentDate, 'appointmentDate'),
  reason: assertString(body.reason, 'reason', { min: 0, max: 500, optional: true }) || '',
});

const validateAppointmentStatus = (body) => ({
  status: assertEnum(body.status, 'status', APPOINTMENT_STATUSES),
});

const validateQueueCheckin = (body) => ({
  patientId: assertUuid(body.patientId, 'patientId'),
  doctorId: assertUuid(body.doctorId, 'doctorId'),
  appointmentId: assertUuid(body.appointmentId, 'appointmentId', { optional: true }) || null,
});

const validateQueueStatus = (body) => ({
  status: assertEnum(body.status, 'status', QUEUE_STATUSES),
});

module.exports = {
  ROLES,
  GENDERS,
  APPOINTMENT_STATUSES,
  QUEUE_STATUSES,
  assertEnum,
  assertInt,
  assertSearch,
  assertUuid,
  validateAuthRegister,
  validateAuthLogin,
  validatePatient,
  validateAppointment,
  validateAppointmentStatus,
  validateQueueCheckin,
  validateQueueStatus,
};
