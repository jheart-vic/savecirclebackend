-- The running app connects as savecircle_app, which cannot bypass row-level security.
-- The role itself is created once per Neon branch by hand (its password is never committed).
GRANT USAGE ON SCHEMA public TO savecircle_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO savecircle_app;

-- Tables created by later migrations (run as the owner) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO savecircle_app;

-- Migration history belongs to the owner only.
REVOKE ALL ON TABLE "_prisma_migrations" FROM savecircle_app;
