-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_id_idx" ON "audit_log"("actor_user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_id_idx" ON "audit_log"("entity_type", "id" DESC);

-- CreateIndex
CREATE INDEX "event_ends_at_id_idx" ON "event"("ends_at", "id");

-- The three below are hand-written: Prisma's schema language cannot express a
-- GIN index, an operator class, or a partial index, so they live here and not
-- in schema.prisma. A later `migrate dev` does not read them as drift.

-- GET /events?q= is `title ILIKE '%term%'`, which no btree can serve. pg_trgm
-- is a deployment requirement from this migration on; the handbook says so.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "event_title_trgm_idx" ON "event" USING gin ("title" gin_trgm_ops);

-- The delivery sweep asks for PENDING and nothing else, and its working set is
-- whatever has not been sent yet, so a partial index stays near-empty however
-- large the table grows. Without it the sweep was a parallel sequential scan of
-- every notification ever written.
CREATE INDEX "notification_email_status_pending_idx"
  ON "notification" ("id")
  WHERE "email_status" = 'PENDING';
