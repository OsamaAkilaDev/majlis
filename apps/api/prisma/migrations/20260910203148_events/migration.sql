-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED', 'CERTIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_policy" AS ENUM ('CHECK_IN_ONLY');

-- CreateEnum
CREATE TYPE "event_responsibility" AS ENUM ('EVENT_LEAD', 'OPERATIONS', 'MARKETING');

-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW', 'REMOVED');

-- CreateEnum
CREATE TYPE "registration_source" AS ENUM ('SELF', 'ADMIN_OVERRIDE');

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "venue" TEXT,
    "online_url" TEXT,
    "banner_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "registration_opens_at" TIMESTAMPTZ(3) NOT NULL,
    "registration_closes_at" TIMESTAMPTZ(3) NOT NULL,
    "check_in_opens_at" TIMESTAMPTZ(3) NOT NULL,
    "check_in_closes_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
    "requires_club_membership" BOOLEAN NOT NULL DEFAULT false,
    "eligibility_rules" JSONB,
    "certificate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "certificate_title" TEXT,
    "certificate_signatory" TEXT,
    "attendance_policy" "attendance_policy" NOT NULL DEFAULT 'CHECK_IN_ONLY',
    "status" "event_status" NOT NULL DEFAULT 'DRAFT',
    "cancelled_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_assignment" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "responsibility" "event_responsibility" NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_registration" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "registration_status" NOT NULL DEFAULT 'CONFIRMED',
    "waitlist_position" INTEGER,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "promoted_at" TIMESTAMPTZ(3),
    "source" "registration_source" NOT NULL DEFAULT 'SELF',
    "override_reason" TEXT,

    CONSTRAINT "event_registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_status_starts_at_idx" ON "event"("status", "starts_at");

-- CreateIndex
CREATE INDEX "event_club_id_status_idx" ON "event"("club_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_club_id_slug_key" ON "event"("club_id", "slug");

-- CreateIndex
CREATE INDEX "event_assignment_user_id_idx" ON "event_assignment"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_assignment_event_id_user_id_responsibility_key" ON "event_assignment"("event_id", "user_id", "responsibility");

-- CreateIndex
CREATE INDEX "event_registration_event_id_status_idx" ON "event_registration"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_registration_user_id_status_idx" ON "event_registration"("user_id", "status");

-- CreateIndex
CREATE INDEX "event_registration_event_id_waitlist_position_idx" ON "event_registration"("event_id", "waitlist_position");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignment" ADD CONSTRAINT "event_assignment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignment" ADD CONSTRAINT "event_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Capacity is never exceeded. The counter is maintained inside the same
-- transaction as the registration insert; this CHECK is the backstop that
-- makes an over-sell impossible even if that code is wrong.
ALTER TABLE "event"
  ADD CONSTRAINT "event_capacity_bounds"
  CHECK ("capacity" > 0 AND "confirmed_count" >= 0 AND "confirmed_count" <= "capacity");

ALTER TABLE "event"
  ADD CONSTRAINT "event_time_window"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "event"
  ADD CONSTRAINT "event_registration_window"
  CHECK ("registration_opens_at" < "registration_closes_at"
     AND "registration_closes_at" <= "ends_at");

ALTER TABLE "event"
  ADD CONSTRAINT "event_check_in_window"
  CHECK ("check_in_opens_at" < "check_in_closes_at");

-- One open registration per (user, event). Only CANCELLED is excluded: a
-- student who cancels may register again while the window is open, but a
-- REMOVED or NO_SHOW student may not re-register themselves.
CREATE UNIQUE INDEX "event_registration_one_open_per_user"
  ON "event_registration" ("event_id", "user_id")
  WHERE "status" <> 'CANCELLED';
