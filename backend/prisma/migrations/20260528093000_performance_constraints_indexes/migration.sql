-- Add date-scoped queue token field for safe per-doctor daily uniqueness.
ALTER TABLE "QueueToken" ADD COLUMN "tokenDate" DATE;
UPDATE "QueueToken" SET "tokenDate" = DATE("createdAt");
ALTER TABLE "QueueToken" ALTER COLUMN "tokenDate" SET NOT NULL;

-- Prevent duplicate appointment slots for the same doctor.
CREATE UNIQUE INDEX "Appointment_doctorId_appointmentDate_key" ON "Appointment"("doctorId", "appointmentDate");

-- Prevent duplicate token numbers for the same doctor on the same day.
CREATE UNIQUE INDEX "QueueToken_doctorId_tokenNumber_tokenDate_key" ON "QueueToken"("doctorId", "tokenNumber", "tokenDate");

-- Index common filters, joins, and ordered list access paths.
CREATE INDEX "Doctor_department_idx" ON "Doctor"("department");
CREATE INDEX "Doctor_specialization_idx" ON "Doctor"("specialization");
CREATE INDEX "Doctor_name_idx" ON "Doctor"("name");

CREATE INDEX "Patient_phoneNumber_idx" ON "Patient"("phoneNumber");
CREATE INDEX "Patient_gender_idx" ON "Patient"("gender");
CREATE INDEX "Patient_createdAt_idx" ON "Patient"("createdAt");

CREATE INDEX "Appointment_doctorId_status_idx" ON "Appointment"("doctorId", "status");
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");
CREATE INDEX "Appointment_appointmentDate_idx" ON "Appointment"("appointmentDate");

CREATE INDEX "QueueToken_doctorId_tokenDate_idx" ON "QueueToken"("doctorId", "tokenDate");
CREATE INDEX "QueueToken_doctorId_createdAt_idx" ON "QueueToken"("doctorId", "createdAt");
CREATE INDEX "QueueToken_status_idx" ON "QueueToken"("status");
CREATE INDEX "QueueToken_patientId_idx" ON "QueueToken"("patientId");
CREATE INDEX "QueueToken_appointmentId_idx" ON "QueueToken"("appointmentId");
