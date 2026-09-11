-- CreateEnum
CREATE TYPE "attendance_method" AS ENUM ('QR_SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "certificate_status" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "qr_pass" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_rotated_at" TIMESTAMPTZ(3),

    CONSTRAINT "qr_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by_id" UUID NOT NULL,
    "method" "attendance_method" NOT NULL,
    "device_hint" TEXT,
    "manual_reason" TEXT,
    "corrected_at" TIMESTAMPTZ(3),
    "corrected_by_id" UUID,
    "correction_reason" TEXT,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "verification_code" TEXT NOT NULL,
    "status" "certificate_status" NOT NULL DEFAULT 'ACTIVE',
    "holder_name_snapshot" TEXT NOT NULL,
    "event_title_snapshot" TEXT NOT NULL,
    "club_name_snapshot" TEXT NOT NULL,
    "club_logo_snapshot_url" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoked_reason" TEXT,

    CONSTRAINT "certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_pass_user_id_key" ON "qr_pass"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_registration_id_key" ON "attendance_record"("registration_id");

-- CreateIndex
CREATE INDEX "attendance_record_event_id_idx" ON "attendance_record"("event_id");

-- CreateIndex
CREATE INDEX "attendance_record_user_id_idx" ON "attendance_record"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_serial_number_key" ON "certificate"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_verification_code_key" ON "certificate"("verification_code");

-- CreateIndex
CREATE INDEX "certificate_user_id_status_idx" ON "certificate"("user_id", "status");

-- CreateIndex
CREATE INDEX "certificate_event_id_idx" ON "certificate"("event_id");

-- AddForeignKey
ALTER TABLE "qr_pass" ADD CONSTRAINT "qr_pass_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One ACTIVE certificate per registration. This is what makes the issuance
-- job idempotent: running it twice cannot create a duplicate. REVOKED rows
-- are excluded so a reissue is possible and both remain verifiable.
CREATE UNIQUE INDEX "certificate_one_active_per_registration"
  ON "certificate" ("registration_id")
  WHERE "status" = 'ACTIVE';
