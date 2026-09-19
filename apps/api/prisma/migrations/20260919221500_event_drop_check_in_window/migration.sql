-- The check-in window is gone (spec 5.1, revised 2026-09-19). An event is
-- ONGOING for exactly as long as it runs, so `starts_at`/`ends_at` are the
-- only boundaries check-in has, and `event_time_window` already guards them.

ALTER TABLE "event" DROP CONSTRAINT "event_check_in_window";

ALTER TABLE "event"
  DROP COLUMN "check_in_opens_at",
  DROP COLUMN "check_in_closes_at";
