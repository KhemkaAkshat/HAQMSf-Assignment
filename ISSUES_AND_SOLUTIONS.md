# HAQMS Issues & Solutions - Implementation Tracker

**Project**: Hospital Appointment & Queue Management System (HAQMS)  
**Assessment Date**: May 28, 2026  
**Total Issues**: 18  
**Status**: Tracking issues and solutions

---

## Step 3 Security Audit Completion Notes

**Date Completed**: May 28, 2026

### Critical Security Fixes Implemented

| Area | Severity | Risk Found | Fix Implemented |
|---|---|---|---|
| Credential logging | Critical | Registration and login handlers logged raw request bodies and plaintext passwords. | Removed sensitive logs and kept only structured email/role attempt metadata. |
| JWT authentication | Critical | Hardcoded fallback secret, 365-day tokens, expiration ignored during verification, token persisted in localStorage. | Added strong secret enforcement, dev-only volatile fallback, 30-minute expiry, issuer/audience/algorithm validation, real expiry enforcement, httpOnly auth cookie, and frontend localStorage token removal. |
| Authorization bypass | Critical | Legacy admin middleware allowed any authenticated user to delete patients. | Replaced delete route with `authorize('ADMIN')` and made legacy admin middleware enforce the admin role. |
| SQL injection | Critical | Doctor search used string-built SQL and `$queryRawUnsafe()`. | Replaced raw SQL with Prisma `findMany` filters and bounded search validation. |
| Input validation | High | Auth, patient, appointment, search, and queue endpoints accepted malformed payloads. | Added centralized validation helpers for email, password, UUID, enum, integer, date, phone, and bounded search inputs. |
| Error handling | High | API handlers exposed stack traces, SQL messages, and raw database errors. | Added centralized async/error middleware with consistent safe `{ success, error, code }` responses. |
| Sensitive data exposure | High | Registration returned password hashes; broad relation includes returned unnecessary fields. | Added Prisma `select` projections for users, patients, doctors, appointments, and queue relations. |

### Reasoning

The Step 3 changes prioritize production-impact security defects before deeper optimization work. JWT handling now fails closed in production if `JWT_SECRET` is missing or weak, while development remains usable through a volatile non-persistent secret. Validation is implemented without a new dependency to avoid package churn and keep the patch small, but the validators follow the same boundary-enforcement role that Zod/Joi/express-validator would provide.

### Verification

- `node --check` passed for backend entrypoint, route files, auth middleware, and new utility files.
- `npm exec prisma validate` passed from `backend/` using the pinned Prisma 5 toolchain.
- `npx eslint src/context/AuthContext.js` passed.
- `npm run prisma:generate --prefix backend` could not complete because Windows returned `EPERM` while replacing Prisma's query engine DLL, likely due to a locked file under `backend/node_modules/.prisma/client`.
- Full frontend lint is still blocked by existing dashboard `react-hooks/set-state-in-effect` findings around data-fetch effects.

---

## Step 3 Backend, Database & Concurrency Optimization Notes

**Date Completed**: May 28, 2026

### Performance Fixes Implemented

| Area | Bottleneck Found | Fix Implemented | Expected Impact |
|---|---|---|---|
| N+1 appointment list | Appointment listing previously fetched appointments, then queried patient and doctor per row. | Replaced with Prisma relation loading and field-level `select`. | Query count drops from `1 + 2N` to a single relation query. |
| Sequential doctor stats | Independent count/aggregate queries were awaited one-by-one. | Replaced with `Promise.all()`. | Endpoint latency becomes bounded by the slowest independent query instead of the sum of all queries. |
| Slow doctor report | Report route fetched nested relation payloads and counted in JavaScript. | Replaced with DB-level `groupBy` for appointment status counts and queue counts, plus one doctor metadata query. | Smaller payloads, less JS CPU work, less event-loop blocking. |
| Queue race condition | Token generation used max-token read followed by insert, which could duplicate under concurrent requests. | Added `QueueToken.tokenDate`, unique `(doctorId, tokenNumber, tokenDate)`, serializable transaction, and retry on Prisma `P2002`/`P2034`. | Concurrent check-ins retry safely and produce unique daily token numbers. |
| Patient pagination | Patient listing previously loaded all rows and sliced in memory. | Uses Prisma `skip`/`take`, DB filters, and parallel count/list queries. | Lower memory usage and stable large-list behavior. |
| Over-fetching | Queue, doctor, appointment, and patient routes returned broad records/relations. | Added `select`/optimized `include` projections. | Smaller API payloads and less DB/network work. |
| Response consistency | Some routes returned arrays, others nested objects. | Added consistent `success`, `data`, `count`, and pagination metadata while preserving legacy keys where needed. | Easier client handling without breaking current UI flows. |

### Database Changes

- Added `Appointment @@unique([doctorId, appointmentDate])` to block duplicate doctor slot bookings.
- Added `QueueToken.tokenDate @db.Date`.
- Added `QueueToken @@unique([doctorId, tokenNumber, tokenDate])` for daily per-doctor token uniqueness.
- Added indexes:
  - `Doctor`: `department`, `specialization`, `name`
  - `Patient`: `phoneNumber`, `gender`, `createdAt`
  - `Appointment`: `(doctorId, status)`, `patientId`, `appointmentDate`
  - `QueueToken`: `(doctorId, tokenDate)`, `(doctorId, createdAt)`, `status`, `patientId`, `appointmentId`
- Added migration: `backend/prisma/migrations/20260528093000_performance_constraints_indexes/migration.sql`

### Verification

- `node --check` passed for optimized queue, reports, and appointments routes.
- `npm exec prisma validate` passed from `backend/`.
- Backend optimized route import smoke test passed.
- Static scan found no remaining `queryRawUnsafe`, artificial `setTimeout` race delay, or in-memory `.slice()` pagination in backend routes.
- `npm run prisma:generate --prefix backend` is still blocked by Windows `EPERM` while replacing Prisma's query engine DLL under `backend/node_modules/.prisma/client`; close any running Node/API processes and rerun generation/migration before runtime testing.

---

## 🔴 CRITICAL ISSUES

### ISSUE #1: Raw Password Credential Logging

**What Was Found:**
- Plain text passwords logged to console in authentication endpoints
- Location: `backend/src/routes/auth.js` lines 13 and 58
- Registration logs: `console.log('[DEBUG] Registering user with payload:', JSON.stringify(req.body))`
- Login logs: `console.log(`[AUTH] Login attempt for email: ${req.body.email} with password: ${req.body.password}`)`
- **Impact**: Credentials exposed in server logs, monitoring systems, and debug dumps

**How We Solved It:**
- [ ] PENDING: Remove sensitive logging from auth endpoints
- [ ] PENDING: Keep only non-sensitive info (email, user ID, timestamp)
- [ ] PENDING: Add proper debug logging without credentials

**Solution Code** (When Implemented):
```javascript
// BEFORE (Line 13):
console.log('[DEBUG] Registering user with payload:', JSON.stringify(req.body));

// AFTER:
console.log(`[AUTH] User registration attempted: ${email}`);

// BEFORE (Line 58):
console.log(`[AUTH] Login attempt for email: ${req.body.email} with password: ${req.body.password}`);

// AFTER:
console.log(`[AUTH] Login attempt: ${email}`);
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #2: SQL Injection Vulnerability in Doctor Search

**What Was Found:**
- SQL queries constructed using string concatenation instead of parameterized queries
- Location: `backend/src/routes/doctors.js` lines 15-35
- Vulnerable code: `conditions.push(`name ILIKE '%${search}%'`);`
- Allows UNION-based SQL injection attacks
- **Impact**: Complete database compromise, credential theft, data exfiltration

**Proof of Concept:**
```
Payload: House%' UNION SELECT id, email, password, name, role, '09:00', '17:00', 0, id FROM "User" --
Result: User table data (passwords) returned
```

**How We Solved It:**
- [ ] PENDING: Replace `$queryRawUnsafe()` with `$queryRaw()` using parameter placeholders
- [ ] PENDING: Whitelist specialization values (ENUM check)
- [ ] PENDING: Use Prisma's standard `findMany()` with ORM filters

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 15-35):
let query = 'SELECT * FROM "Doctor"';
const conditions = [];
if (search) {
  conditions.push(`name ILIKE '%${search}%'`); // VULNERABLE
}
const doctors = await prisma.$queryRawUnsafe(query + ' WHERE ' + conditions.join(' AND '));

// AFTER:
const doctors = await prisma.doctor.findMany({
  where: {
    AND: [
      search ? { name: { contains: search, mode: 'insensitive' } } : {},
      specialization && specialization !== 'All' ? { specialization } : {}
    ]
  }
});
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #3: Bypassed Authorization - Admin-Only Delete

**What Was Found:**
- Admin role check commented out in middleware
- Location: `backend/src/middleware/auth.js` lines 37-48 (authorizeAdminOnlyLegacy function)
- Used in: `backend/src/routes/patients.js` line 68 (DELETE endpoint)
- Any authenticated user (receptionist, doctor) can delete patients
- **Impact**: Unauthorized data deletion, HIPAA violations, audit trail compromise

**Reproduction:**
1. Login as Receptionist
2. Click delete on any patient
3. Expected: 403 Forbidden
4. Actual: Patient deleted successfully (BYPASS!)

**How We Solved It:**
- [ ] PENDING: Uncomment the role verification check
- [ ] PENDING: Replace `authorizeAdminOnlyLegacy` with proper `authorize('ADMIN')` middleware
- [ ] PENDING: Apply to all admin-only endpoints

**Solution Code** (When Implemented):
```javascript
// BEFORE (auth.js Lines 37-48):
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  // TODO: Implement actual admin role verification here
  // if (req.user.role !== 'ADMIN') {
  //   return res.status(403).json({ error: 'Access denied. Admin only.' });
  // }
  next(); // BYPASSED!
};

// AFTER:
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. User context missing.' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
};

// USAGE in patients.js:
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  // Delete logic...
});
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #4: Weak JWT Implementation

**What Was Found:**
- JWT tokens use hardcoded secret: `'my-super-secret-secret-key-12345!!!'`
- Expiration set to 365 days (effectively no expiration)
- JWT verification ignores expiration: `{ ignoreExpiration: true }`
- Tokens stored in localStorage (vulnerable to XSS)
- Location: `backend/src/routes/auth.js` lines 59-65, `backend/src/middleware/auth.js` line 14
- **Impact**: Compromised tokens valid forever, session hijacking, token forgery

**What We Found:**
- Decoded token shows exp: November 2027 (365 days)
- Server doesn't verify expiration despite setting it
- Secret is hardcoded and obvious

**How We Solved It:**
- [ ] PENDING: Create `.env` file with strong random JWT_SECRET
- [ ] PENDING: Change token expiry from 365d to 15-30 minutes
- [ ] PENDING: Remove `ignoreExpiration: true` flag
- [ ] PENDING: Implement refresh token pattern
- [ ] PENDING: Switch to httpOnly cookies instead of localStorage

**Solution Code** (When Implemented):
```javascript
// BEFORE (auth.js Lines 59-65):
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-secret-key-12345!!!';
const token = jwt.sign(
  { id: user.id, email: user.email, role: user.role, name: user.name },
  JWT_SECRET,
  { expiresIn: '365d' }  // 365-day token!
);

// BEFORE (middleware/auth.js Line 14):
const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });

// AFTER (auth.js):
const JWT_SECRET = process.env.JWT_SECRET; // Must be set in .env
const token = jwt.sign(
  { id: user.id, email: user.email, role: user.role, name: user.name },
  JWT_SECRET,
  { expiresIn: '15m' }  // 15-minute token
);

// AFTER (middleware/auth.js):
const decoded = jwt.verify(token, JWT_SECRET); // No ignoreExpiration flag
```

**Create .env File:**
```
JWT_SECRET=your-very-long-random-secret-here-at-least-32-characters
DATABASE_URL="postgresql://user:password@localhost:5432/haqms?schema=public"
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #5: Token Race Condition - Duplicate Token Numbers

**What Was Found:**
- Token number generation has 350ms race condition window
- Location: `backend/src/routes/queue.js` lines 29-58
- Two concurrent requests see same max token, both create same token number
- Artificial 350ms sleep between checking max and creating record
- **Impact**: Duplicate tokens, queue confusion, patient calling errors

**Reproduction:**
1. Open two browser tabs logged in as receptionist
2. Both go to Dashboard → "Active Direct Queue Check-In"
3. Both select SAME patient and doctor
4. Both click "Generate Live Token" simultaneously
5. Expected: Token #1 and Token #2
6. Actual: Both get Token #1 (DUPLICATE!)

**How We Solved It:**
- [ ] PENDING: Use database transaction with pessimistic locking (SELECT FOR UPDATE)
- [ ] PENDING: OR add database sequence/auto-increment for token generation
- [ ] PENDING: Remove artificial setTimeout delay
- [ ] PENDING: Add unique constraint on (doctorId, tokenNumber, date) in schema

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 29-58):
const maxTokenResult = await prisma.queueToken.aggregate({
  where: { doctorId, createdAt: { gte: today } },
  _max: { tokenNumber: true }
});
const nextTokenNumber = (maxTokenResult._max.tokenNumber || 0) + 1;

await new Promise((resolve) => setTimeout(resolve, 350)); // RACE WINDOW!

const newToken = await prisma.queueToken.create({
  data: { tokenNumber: nextTokenNumber, patientId, doctorId, ... }
});

// AFTER (Using Transaction):
const newToken = await prisma.$transaction(async (tx) => {
  const maxTokenResult = await tx.queueToken.aggregate({
    where: { doctorId, createdAt: { gte: today } },
    _max: { tokenNumber: true }
  });
  const nextTokenNumber = (maxTokenResult._max.tokenNumber || 0) + 1;

  return tx.queueToken.create({
    data: {
      tokenNumber: nextTokenNumber,
      patientId,
      doctorId,
      appointmentId: appointmentId || null,
      status: 'WAITING'
    }
  });
});
```

**Schema Changes Needed:**
```prisma
// In schema.prisma - Add unique constraint
model QueueToken {
  // ... existing fields ...
  
  // Add this constraint
  @@unique([doctorId, tokenNumber, createdAt])
}
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #6: Null Reference Crash - Medical History Display

**What Was Found:**
- Code calls `.toUpperCase()` on nullable medical history field
- Location: `frontend/src/app/dashboard/page.js` line 920
- Patients with NULL medical history crash entire React app
- Test patients: Clark Kent, Bruce Wayne
- **Impact**: App crash for doctors viewing patients without history, complete UI freeze

**Crash Error:**
```
Cannot read properties of null (reading 'toUpperCase')
```

**Reproduction:**
1. Login as Doctor (doctor1@haqms.com)
2. Go to Dashboard → "My Scheduled Bookings"
3. Click on Clark Kent or Bruce Wayne patient name
4. Modal opens and crashes with null reference error
5. Entire React app becomes unresponsive

**How We Solved It:**
- [ ] PENDING: Add optional chaining operator (`?.`)
- [ ] PENDING: Provide fallback text when medical history is null

**Solution Code** (When Implemented):
```javascript
// BEFORE (Line 920):
<p className="text-slate-700 dark:text-slate-300 leading-5 text-sm font-semibold">
  {selectedPatientHistory.medicalHistory.toUpperCase()}
</p>

// AFTER:
<p className="text-slate-700 dark:text-slate-300 leading-5 text-sm font-semibold">
  {selectedPatientHistory.medicalHistory?.toUpperCase() || 'No medical history on file'}
</p>
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #7: Missing Database Migrations - Uninitialized Database

**What Was Found:**
- Prisma migrations were not applied to PostgreSQL database
- Location: Backend database initialization
- Error when trying to fetch reports: `P2022 - The table does not exist in the current database`
- All API endpoints that query the database return 500 errors with P2022 code
- **Impact**: Application completely non-functional until migrations are run

**Reproduction:**
1. Start PostgreSQL with Docker
2. Start backend without running migrations
3. Try to access any API endpoint that queries data (e.g., GET `/api/reports/doctor-stats`)
4. Error: `{ "success": false, "error": "Internal server error", "code": "P2022" }`
5. Doctor Revenue & Operations Report doesn't load

**How We Solved It:**
- [x] COMPLETED: Run Prisma migrations with `npx prisma migrate deploy`
- [x] COMPLETED: Seed database with test data using `npx prisma db seed`
- [x] COMPLETED: Verify all tables and data exist

**Solution Code** (Setup Commands):
```bash
# Step 1: Start PostgreSQL in Docker
docker-compose up

# Step 2: Navigate to backend
cd backend

# Step 3: Install dependencies (if not already done)
npm install

# Step 4: Apply all database migrations
npx prisma migrate deploy

# Step 5: Seed test data (optional but recommended)
npx prisma db seed

# Step 6: Start backend server
npm start
```

**Verification:** ✅ VERIFIED  
**Completion Date**: May 28, 2026

---

## 🟠 HIGH PRIORITY ISSUES

### ISSUE #8: Hardcoded API Base URL

**What Was Found:**
- Backend API URL hardcoded in multiple frontend files
- Location: `frontend/src/context/AuthContext.js` line 15, `frontend/src/app/queue/page.js` line 15
- Hardcoded: `http://localhost:5000/api`
- Makes deployment difficult, duplicated code, architecture exposed
- **Impact**: Deployment blocker, can't change API endpoint without rebuilding

**How We Solved It:**
- [ ] PENDING: Create `.env.local` file with `NEXT_PUBLIC_API_BASE_URL`
- [ ] PENDING: Update AuthContext to use `process.env.NEXT_PUBLIC_API_BASE_URL`
- [ ] PENDING: Update queue/page.js to use context or imported constant
- [ ] PENDING: Centralize URL in single location (don't duplicate)

**Solution Code** (When Implemented):
```
# .env.local (new file to create)
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api
```

```javascript
// BEFORE (AuthContext.js Line 15):
const API_BASE_URL = 'http://localhost:5000/api';

// AFTER:
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000/api';

// BEFORE (queue/page.js Line 15 - duplicated):
const API_BASE_URL = 'http://localhost:5000/api';

// AFTER (use from context):
const { API_BASE_URL } = useAuth();
// OR import from single location
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #8: N+1 Database Query Problem

**What Was Found:**
- Appointments endpoint fetches core appointments, then loops fetching patient/doctor for each
- Location: `backend/src/routes/appointments.js` lines 16-45
- Query count: 1 + N (patients) + N (doctors) = 2N+1 instead of 1
- With 50 appointments: 101 queries instead of 1
- **Impact**: 50+ appointments take 1+ second instead of <100ms

**Performance Before Fix:**
```
50 appointments = 1 + 50 + 50 = 101 queries
At 10ms per query = ~1 second (should be <50ms)
```

**How We Solved It:**
- [ ] PENDING: Use Prisma `include` to fetch relations in single query
- [ ] PENDING: Select only needed fields to minimize payload

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 16-45):
const appointments = await prisma.appointment.findMany({
  where,
  orderBy: { appointmentDate: 'asc' }
});

const detailedAppointments = [];
for (const app of appointments) {
  const patient = await prisma.patient.findUnique({ where: { id: app.patientId } });
  const doctor = await prisma.doctor.findUnique({ where: { id: app.doctorId } });
  detailedAppointments.push({
    ...app,
    patient,
    doctor
  });
}

// AFTER:
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
        medicalHistory: true
      }
    },
    doctor: {
      select: {
        id: true,
        name: true,
        specialization: true
      }
    }
  }
});

// Can send directly:
res.json({
  success: true,
  count: appointments.length,
  appointments
});
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #9: Sequential Async Operations (Doctor Stats)

**What Was Found:**
- Doctor stats endpoint runs independent queries sequentially instead of parallel
- Location: `backend/src/routes/doctors.js` lines 42-66
- 4 independent queries run one-after-another with `await`
- Should run in parallel with `Promise.all()`
- **Impact**: 40ms instead of 10ms (4x slower)

**How We Solved It:**
- [ ] PENDING: Replace sequential awaits with `Promise.all()`
- [ ] PENDING: Execute all independent queries in parallel

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 42-66):
const totalDoctors = await prisma.doctor.count();
const surgeonsCount = await prisma.doctor.count({ where: { department: 'Surgery' } });
const averageFee = await prisma.doctor.aggregate({ _avg: { consultationFee: true } });
const highestExperience = await prisma.doctor.aggregate({ _max: { experience: true } });

// ~40ms total (10ms + 10ms + 10ms + 10ms)

// AFTER:
const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
  prisma.doctor.count(),
  prisma.doctor.count({ where: { department: 'Surgery' } }),
  prisma.doctor.aggregate({ _avg: { consultationFee: true } }),
  prisma.doctor.aggregate({ _max: { experience: true } })
]);

// ~10ms total (all parallel)
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #10: Slow Report Endpoint (Nested Queries)

**What Was Found:**
- Report endpoint loops through each doctor and runs 5+ queries per doctor
- Location: `backend/src/routes/reports.js` lines 11-60
- Artificial 80ms delay per doctor
- With 10 doctors: 50+ queries + 800ms delay = 2-3 seconds
- **Impact**: Admin reports take 2-3 seconds (should be <300ms)

**Query Breakdown:**
- 1 query: fetch all doctors
- Per doctor (5 queries each):
  - count total appointments
  - count completed appointments
  - count cancelled appointments
  - count queue tokens today
  - fetch all completed appointments
- Plus 80ms artificial delay per doctor

**How We Solved It:**
- [ ] PENDING: Use single aggregation query instead of loops
- [ ] PENDING: Remove artificial setTimeout delays
- [ ] PENDING: Use Prisma aggregations with includes

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 11-60):
const doctors = await prisma.doctor.findMany();
const reportData = [];

for (const doc of doctors) {
  const totalAppointments = await prisma.appointment.count({ where: { doctorId: doc.id } });
  const completedAppointments = await prisma.appointment.count({ where: { doctorId: doc.id, status: 'COMPLETED' } });
  const cancelledAppointments = await prisma.appointment.count({ where: { doctorId: doc.id, status: 'CANCELLED' } });
  const queueTokensCount = await prisma.queueToken.count({ where: { doctorId: doc.id, createdAt: { gte: today } } });
  const appointmentsList = await prisma.appointment.findMany({ where: { doctorId: doc.id, status: 'COMPLETED' } });
  const revenue = appointmentsList.length * doc.consultationFee;
  
  await new Promise(r => setTimeout(r, 80)); // REMOVE THIS
  
  reportData.push({ ... });
}

// AFTER:
const start = Date.now();

const doctorsWithStats = await prisma.doctor.findMany({
  include: {
    _count: {
      select: {
        appointments: true,
        queueTokens: { where: { createdAt: { gte: today } } }
      }
    },
    appointments: {
      where: { status: 'COMPLETED' },
      select: { id: true, status: true }
    }
  }
});

const reportData = doctorsWithStats.map(doc => ({
  id: doc.id,
  name: doc.name,
  specialization: doc.specialization,
  department: doc.department,
  totalAppointments: doc._count.appointments,
  completedAppointments: doc.appointments.length,
  cancelledAppointments: doc._count.appointments - doc.appointments.length,
  todayQueueSize: doc._count.queueTokens,
  revenue: doc.appointments.length * doc.consultationFee
}));

const durationMs = Date.now() - start;
res.json({ success: true, timeTakenMs: durationMs, data: reportData });
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #11: In-Memory Pagination

**What Was Found:**
- Patient listing fetches ALL patients, filters in memory, paginates in memory
- Location: `backend/src/routes/patients.js` lines 16-50
- No SQL LIMIT/OFFSET, no database-level filtering
- With 10k patients: loads entire dataset into memory
- **Impact**: Memory usage, slow searches, poor scalability

**How We Solved It:**
- [ ] PENDING: Use Prisma `findMany()` with `skip`/`take` for pagination
- [ ] PENDING: Use Prisma `where` filters for search
- [ ] PENDING: Count total with separate query for pagination info

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 16-50):
const allPatients = await prisma.patient.findMany({ orderBy: { createdAt: 'desc' } });

let filteredPatients = allPatients;
if (search) {
  const query = search.toLowerCase();
  filteredPatients = filteredPatients.filter(p =>
    p.name.toLowerCase().includes(query) || p.phoneNumber.includes(query) || ...
  );
}
if (gender && gender !== 'All') {
  filteredPatients = filteredPatients.filter(p => p.gender.toLowerCase() === gender.toLowerCase());
}

const offset = (page - 1) * limit;
const paginatedResult = filteredPatients.slice(offset, offset + limit);

// AFTER:
const [patients, totalCount] = await Promise.all([
  prisma.patient.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {},
        gender && gender !== 'All' ? { gender: { equals: gender } } : {}
      ]
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit
  }),
  prisma.patient.count({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } }
          ]
        } : {},
        gender && gender !== 'All' ? { gender: { equals: gender } } : {}
      ]
    }
  })
]);

res.json({
  success: true,
  patients,
  pagination: {
    page,
    limit,
    totalPatients: totalCount,
    totalPages: Math.ceil(totalCount / limit)
  }
});
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #12: Missing Double-Booking Prevention

**What Was Found:**
- Appointment schema lacks unique constraint on (doctorId, appointmentDate)
- Location: `backend/prisma/schema.prisma` lines 43-47
- Backend check only verifies exact millisecond (easily bypassed)
- Multiple appointments can be booked for same doctor at same time
- **Impact**: Double-booking allowed, scheduling conflicts

**How We Solved It:**
- [ ] PENDING: Add `@@unique([doctorId, appointmentDate])` to Appointment model
- [ ] PENDING: Run migration to add constraint

**Schema Change** (When Implemented):
```prisma
// BEFORE:
model Appointment {
  id              String            @id @default(uuid())
  patientId       String
  patient         Patient           @relation(fields: [patientId], references: [id])
  doctorId        String
  doctor          Doctor            @relation(fields: [doctorId], references: [id])
  appointmentDate DateTime
  reason          String            @default("")
  status          AppointmentStatus @default(PENDING)
  createdAt       DateTime          @default(now())

  queueTokens QueueToken[]
}

// AFTER:
model Appointment {
  id              String            @id @default(uuid())
  patientId       String
  patient         Patient           @relation(fields: [patientId], references: [id])
  doctorId        String
  doctor          Doctor            @relation(fields: [doctorId], references: [id])
  appointmentDate DateTime
  reason          String            @default("")
  status          AppointmentStatus @default(PENDING)
  createdAt       DateTime          @default(now())

  queueTokens QueueToken[]

  @@unique([doctorId, appointmentDate])
}
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #13: Missing Database Indices

**What Was Found:**
- No indices on frequently queried columns causing full table scans
- Location: `backend/prisma/schema.prisma`
- Missing indices:
  - Doctor: `department`, `specialization` (for filtering/search)
  - Appointment: `(doctorId, status)` (for doctor worklist), `patientId` (FK lookup)
  - QueueToken: `(doctorId, createdAt)` (for daily aggregation), `status` (for filtering)
- **Impact**: Slow queries as data grows, poor scalability

**How We Solved It:**
- [ ] PENDING: Add `@@index()` directives to schema
- [ ] PENDING: Run migration to create indices

**Schema Changes** (When Implemented):
```prisma
// Doctor indices
model Doctor {
  // ... existing fields ...
  
  @@index([department])
  @@index([specialization])
}

// Appointment indices
model Appointment {
  // ... existing fields ...
  
  @@index([doctorId, status])
  @@index([patientId])
  @@unique([doctorId, appointmentDate])
}

// QueueToken indices
model QueueToken {
  // ... existing fields ...
  
  @@index([doctorId, createdAt])
  @@index([status])
  @@unique([doctorId, tokenNumber, createdAt])
}
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #14: Memory Leak in Queue Monitor

**What Was Found:**
- setInterval created but never cleaned up when component unmounts
- Location: `frontend/src/app/queue/page.js` lines 29-49
- Missing return statement with cleanup function
- Navigating away leaves interval running
- Multiple navigations = dozens of parallel intervals
- **Impact**: Memory bloat, API request spam, state update crashes

**Reproduction:**
Navigate to /queue → /dashboard → /queue 10 times = 10 active intervals

**How We Solved It:**
- [ ] PENDING: Add return cleanup function to useEffect
- [ ] PENDING: Clear interval on component unmount

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 29-49):
useEffect(() => {
  fetchQueueData();

  const intervalId = setInterval(() => {
    console.log(`[POLL] Active Queue Poll #${refreshCount + 1} firing...`);
    fetchQueueData();
    setRefreshCount((prev) => prev + 1);
  }, 3000);

  // MISSING: return () => clearInterval(intervalId);
}, []);

// AFTER:
useEffect(() => {
  fetchQueueData();

  const intervalId = setInterval(() => {
    console.log(`[POLL] Active Queue Poll #${refreshCount + 1} firing...`);
    fetchQueueData();
    setRefreshCount((prev) => prev + 1);
  }, 3000);

  // ADDED: Cleanup function
  return () => clearInterval(intervalId);
}, []);
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #15: Unnecessary Re-renders on Search

**What Was Found:**
- Search input triggers full component re-render and API call on every keystroke
- Location: `frontend/src/app/dashboard/page.js` lines 156-160
- No debounce on search input
- 10 keystrokes = 10 API calls (should be 1)
- **Impact**: API spam, UI lag on slower connections

**How We Solved It:**
- [ ] PENDING: Add debounce hook on search input
- [ ] PENDING: Wait 300ms after typing stops before making API call

**Solution Code** (When Implemented):
```javascript
// BEFORE (Lines 156-160):
useEffect(() => {
  if (user.role === 'RECEPTIONIST' || user.role === 'ADMIN') {
    fetchPatients(1);
  }
}, [patientSearch, patientGender]); // Triggers on every keystroke

// AFTER:
const [debouncedSearch, setDebouncedSearch] = useState('');

useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(patientSearch), 300);
  return () => clearTimeout(timer);
}, [patientSearch]);

useEffect(() => {
  if (user.role === 'RECEPTIONIST' || user.role === 'ADMIN') {
    fetchPatients(1);
  }
}, [debouncedSearch, patientGender]); // Triggers 300ms after typing stops
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

### ISSUE #16: Missing Patient History Records Page

**What Was Found:**
- Route `/patients/[id]/history-records` doesn't exist
- Location: Missing file `frontend/src/app/patients/[id]/history-records/page.js`
- Clicking "View Diagnostic Reports Details" link triggers 404
- **Impact**: Broken user workflow, incomplete feature

**How We Solved It:**
- [ ] PENDING: Create page file structure
- [ ] PENDING: Add `useParams()` hook to get patient ID
- [ ] PENDING: Fetch patient diagnostic data
- [ ] PENDING: Create UI to display reports

**Solution Code** (When Implemented):
```javascript
// Create: frontend/src/app/patients/[id]/history-records/page.js

'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/common/Navbar';
import { ArrowLeft, FileText, Calendar } from 'lucide-react';
import Link from 'next/link';

export default function PatientHistoryRecords() {
  const { id } = useParams();
  const { token, API_BASE_URL } = useAuth();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatientData = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/patients/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setPatient(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    if (id && token) {
      fetchPatientData();
    }
  }, [id, token, API_BASE_URL]);

  if (loading) return <div>Loading...</div>;
  if (!patient) return <div>Patient not found</div>;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 sm:p-8">
        <Link href="/dashboard" className="flex items-center gap-1 text-teal-600 mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="glass p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Clinical History Records
          </h1>
          <p className="text-sm text-slate-500 mt-2">Patient: {patient.name}</p>

          <div className="mt-6 space-y-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Medical History
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                {patient.medicalHistory || 'No medical history on file'}
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Patient Demographics
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Age</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{patient.age} years</p>
                </div>
                <div>
                  <p className="text-slate-500">Gender</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{patient.gender}</p>
                </div>
                <div>
                  <p className="text-slate-500">Contact</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{patient.phoneNumber}</p>
                </div>
                <div>
                  <p className="text-slate-500">Email</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{patient.email || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Verification**: ✅ / ❌  
**Completion Date**: [To be filled]

---

## 📋 Implementation Summary

| # | Issue | Priority | Status | Completion Date |
|---|-------|----------|--------|-----------------|
| 1 | Password Logging | 🔴 | [ ] | |
| 2 | SQL Injection | 🔴 | [ ] | |
| 3 | Authorization Bypass | 🔴 | [ ] | |
| 4 | Weak JWT | 🔴 | [ ] | |
| 5 | Token Race Condition | 🔴 | [ ] | |
| 6 | Null Reference Crash | 🔴 | [ ] | |
| 7 | Missing Migrations | 🔴 | [x] | May 28, 2026 |
| 8 | Hardcoded API URL | 🟠 | [ ] | |
| 9 | N+1 Queries | 🟠 | [ ] | |
| 10 | Sequential Async | 🟠 | [ ] | |
| 11 | Slow Reports | 🟠 | [ ] | |
| 12 | In-Memory Pagination | 🟠 | [ ] | |
| 13 | Double-Booking Prevention | 🟠 | [ ] | |
| 14 | Missing Indices | 🟠 | [ ] | |
| 15 | Memory Leak | 🟠 | [ ] | |
| 16 | Unnecessary Re-renders | 🟠 | [ ] | |
| 17 | Missing History Page | 🟠 | [ ] | |

---

## 📊 Progress Tracking

**Total Issues**: 18  
**Critical**: 7  
**High**: 11  
**Completed**: 1  
**In Progress**: 0  
**Pending**: 17  

**Overall Progress**: 5.6% ✓  
**Last Updated**: May 28, 2026

---

## 🎯 Next Steps

1. Start with CRITICAL issues (Issues #1-6)
2. Mark each [ ] as [x] when completed
3. Update Completion Date
4. Move to HIGH priority issues
5. Test and verify each fix

---

**Document Version**: 1.0  
**Created**: May 28, 2026  
**Updated**: May 28, 2026
