-- Local development bootstrap. Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'majlis') THEN
    CREATE ROLE majlis WITH LOGIN PASSWORD 'majlis' CREATEDB;
  END IF;
END
$$;
