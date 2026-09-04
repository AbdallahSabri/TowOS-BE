-- BE-SPEC §8, migration 002: users, sessions, role enum (admin, dispatcher only).
--
-- Column shapes from TowOS_Technical_Reference.md §3.3, with company_id ->
-- tenant_id (see 001) and user_role trimmed to the two roles BE-SPEC §10 /
-- CLAUDE.md's cut-scope guard allow in this phase - not the five-role enum
-- in the Technical Reference (no driver role yet, ADR-006).
--
-- sessions carries tenant_id directly (not just user_id) so its own RLS
-- policy doesn't need a subquery through the users table: BE-SPEC §7.1 makes
-- tenant_id mandatory on every business table, sessions included. The
-- application is responsible for setting it to the owning user's tenant_id.

CREATE TYPE user_role AS ENUM ('admin', 'dispatcher');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  email         citext NOT NULL,
  phone         text,
  full_name     text NOT NULL,
  password_hash text NOT NULL, -- argon2id
  role          user_role NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON users (tenant_id, email);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  user_agent  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id);
CREATE INDEX ON sessions (tenant_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON users TO towos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO towos_app;
