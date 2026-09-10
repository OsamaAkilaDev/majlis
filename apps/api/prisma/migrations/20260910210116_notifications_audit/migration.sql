-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'DENIED');

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "email_status" "email_status" NOT NULL DEFAULT 'PENDING',
    "email_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "outcome" "audit_outcome" NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_id_dedupe_key_key" ON "notification"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit log is append-only. Application discipline is not enough: a bug,
-- a migration, or a console session must all be refused. Statement-level
-- triggers mean even a bulk UPDATE that touches no rows is rejected.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_update"
  BEFORE UPDATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER "audit_log_no_delete"
  BEFORE DELETE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
