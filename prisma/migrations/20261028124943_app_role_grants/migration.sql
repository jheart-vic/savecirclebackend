-- The running app connects as savecircle_app, which cannot bypass row-level security.
-- The role itself is created once per Neon branch by hand (its password is never committed).
GRANT USAGE ON SCHEMA public TO savecircle_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO savecircle_app;

-- Tables created by later migrations (run as the owner) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO savecircle_app;

-- Migration history belongs to the owner only. Prisma's shadow database has no
-- _prisma_migrations table when it replays this file, so the revoke is skipped there.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM savecircle_app;
  END IF;
END
$$;
