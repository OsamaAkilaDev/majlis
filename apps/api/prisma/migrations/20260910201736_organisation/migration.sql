-- CreateEnum
CREATE TYPE "club_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "membership_policy" AS ENUM ('OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "club_role" AS ENUM ('LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'EXPIRED', 'ENDED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED');

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "academic_year" TEXT NOT NULL,
    "logo_url" TEXT NOT NULL,
    "banner_url" TEXT,
    "membership_policy" "membership_policy" NOT NULL DEFAULT 'OPEN',
    "status" "club_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_team_appointment" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "club_role" NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'INVITED',
    "invited_by_id" UUID NOT NULL,
    "invitation_token_hash" TEXT,
    "invitation_expires_at" TIMESTAMPTZ(3),
    "term_start" TIMESTAMPTZ(3),
    "term_end" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_team_appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_membership" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decision_reason" TEXT,

    CONSTRAINT "club_membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_name_key" ON "department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "department_code_key" ON "department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "club_name_key" ON "club"("name");

-- CreateIndex
CREATE UNIQUE INDEX "club_slug_key" ON "club"("slug");

-- CreateIndex
CREATE INDEX "club_department_id_idx" ON "club"("department_id");

-- CreateIndex
CREATE INDEX "club_status_idx" ON "club"("status");

-- CreateIndex
CREATE UNIQUE INDEX "club_team_appointment_invitation_token_hash_key" ON "club_team_appointment"("invitation_token_hash");

-- CreateIndex
CREATE INDEX "club_team_appointment_club_id_status_idx" ON "club_team_appointment"("club_id", "status");

-- CreateIndex
CREATE INDEX "club_team_appointment_user_id_status_idx" ON "club_team_appointment"("user_id", "status");

-- CreateIndex
CREATE INDEX "club_membership_club_id_status_idx" ON "club_membership"("club_id", "status");

-- CreateIndex
CREATE INDEX "club_membership_user_id_status_idx" ON "club_membership"("user_id", "status");

-- AddForeignKey
ALTER TABLE "club" ADD CONSTRAINT "club_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_team_appointment" ADD CONSTRAINT "club_team_appointment_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_team_appointment" ADD CONSTRAINT "club_team_appointment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_membership" ADD CONSTRAINT "club_membership_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_membership" ADD CONSTRAINT "club_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lead is singular per club. Prisma cannot express a partial unique index,
-- so it is written by hand. INVITED and ENDED rows are excluded on purpose:
-- an invitation grants nothing, and history must be allowed to accumulate.
CREATE UNIQUE INDEX "club_team_appointment_one_active_lead"
  ON "club_team_appointment" ("club_id")
  WHERE "role" = 'LEAD' AND "status" = 'ACTIVE';

-- One open membership per (user, club). PENDING is included so a student
-- cannot queue two requests, and so a request cannot be filed against a
-- membership they already hold.
CREATE UNIQUE INDEX "club_membership_one_open_per_user"
  ON "club_membership" ("club_id", "user_id")
  WHERE "status" IN ('PENDING', 'ACTIVE');
