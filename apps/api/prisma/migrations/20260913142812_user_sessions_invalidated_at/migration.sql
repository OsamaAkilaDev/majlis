-- A rename, not the drop-and-add Prisma generated for it: the column holds
-- live session-invalidation stamps, and dropping it would sign every account
-- that has reset a password back in.
--
-- The new name is what the column always meant. A password reset was only the
-- first thing to stamp it; logout stamps it too, and both mean "refuse every
-- access token this account was issued before this instant".
ALTER TABLE "user" RENAME COLUMN "password_changed_at" TO "sessions_invalidated_at";
