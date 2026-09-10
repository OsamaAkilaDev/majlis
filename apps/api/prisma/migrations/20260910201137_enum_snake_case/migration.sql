-- Prisma's default diff for adding @@map to an existing enum is DROP TYPE +
-- CREATE TYPE via a DROP COLUMN/ADD COLUMN rewrite of every dependent column,
-- which loses data in `status` and `platform_role` on any populated database.
-- A Postgres enum type rename is a metadata-only operation, so it is written
-- by hand here instead of using the generated SQL.
ALTER TYPE "UserStatus" RENAME TO "user_status";
ALTER TYPE "PlatformRole" RENAME TO "platform_role";
