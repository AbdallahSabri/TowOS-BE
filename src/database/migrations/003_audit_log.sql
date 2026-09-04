-- BE-SPEC §8, migration 003: audit_log, append-only.
--
-- Column shapes from TowOS_Technical_Reference.md §3.10, with company_id ->
-- tenant_id (see 001). bigserial PK per the high-volume-append-table
-- convention (Technical_Reference §1), not uuid.
--
-- Append-only is enforced at the database (CLAUDE.md invariant #8): the app
-- role gets INSERT/SELECT only, never UPDATE/DELETE.

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid,
  actor_type    text NOT NULL DEFAULT 'user', -- user | system | integration
  entity_type   text NOT NULL,                -- job, dispatch, call, user, credential
  entity_id     uuid NOT NULL,
  action        text NOT NULL,                -- status_changed, reassigned, forced_transition
  before        jsonb,
  after         jsonb,
  reason        text,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX ON audit_log (tenant_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON audit_log TO towos_app;
REVOKE UPDATE, DELETE ON audit_log FROM towos_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO towos_app;
