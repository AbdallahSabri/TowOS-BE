-- BE-SPEC §8, migration 001: tenants, locations (IANA timezone), RLS on both.
--
-- Column shapes come from TowOS_Technical_Reference.md §3.1-3.2 (companies ->
-- tenants, company_id -> tenant_id: BE-SPEC §7 / CLAUDE.md invariant #1 make
-- tenant_id + real RLS a Phase 0 requirement, superseding ADR-008's original
-- "no RLS yet" single-tenant plan).
--
-- Run under a migration role that may bypass RLS (BE-SPEC §7). towos_app -
-- the application role - must already exist (server setup, BE-SPEC §15) for
-- the GRANT statements below to succeed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Single source of truth for reading the current request's tenant id back out
-- of the SET LOCAL app.tenant_id issued by common/tenant/'s wrapper (BE-SPEC
-- §7.4). current_setting(key, true) returns '' (not NULL) when the GUC was
-- never set in this session - casting '' straight to ::uuid raises a hard
-- error instead of "no rows", which defeats "no tenant context returns zero
-- rows" (BE-SPEC §14). NULLIF collapses that empty string to NULL first, so
-- every RLS policy below gets zero-rows-not-an-error for free.
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  timezone   text NOT NULL DEFAULT 'America/Chicago', -- IANA
  settings   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  timezone   text NOT NULL, -- IANA
  address    jsonb NOT NULL, -- {line1,line2,city,state,zip}
  lat        numeric(9,6),
  lng        numeric(9,6),
  is_active  boolean NOT NULL DEFAULT true
);
CREATE INDEX ON locations (tenant_id);

-- RLS (BE-SPEC §7.1-7.2). FORCE is required: without it, RLS is skipped for
-- the table owner, and the app role must never rely on being a non-owner to
-- stay protected.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
-- A tenant may only see its own row. An unscoped connection (current_tenant_id()
-- is NULL) sees zero rows rather than raising or leaking another tenant's data.
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON tenants TO towos_app;
GRANT SELECT, INSERT, UPDATE ON locations TO towos_app;
