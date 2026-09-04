-- Local test-only Postgres bootstrap for docker-compose.test.yml. Mirrors the
-- real deploy role split (BE-SPEC §7/§15): towos_app is the application role
-- and must never hold BYPASSRLS; the migration role here is just the
-- container's own superuser (postgres), same as DATABASE_MIGRATION_URL in
-- test/jest.setup.ts. Not used by any deployed environment.
CREATE ROLE towos_app LOGIN PASSWORD 'towos_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- USAGE only: towos_app never creates objects, table-level GRANTs for what
-- it can read/write live in the migrations themselves (001-003).
GRANT USAGE ON SCHEMA public TO towos_app;
