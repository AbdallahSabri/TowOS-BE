-- BE-SPEC §8, migration 005: idempotency key store, unique on
-- (tenant_id, endpoint, idempotency_key).
--
-- Not in TowOS_Technical_Reference.md (idempotency is BE-SPEC-only Phase 0
-- infrastructure, not part of the original domain model) - shape follows
-- this repo's established conventions (§1: uuid PK, tenant_id + RLS on
-- every business table, timestamptz).
--
-- BE-SPEC §9: "Keys retained 24 hours in Redis, backed by the table here."
-- Redis (common/idempotency/) is the fast path; this table is the durable
-- copy - Technical_Reference §1's own rule is that Redis is "never a
-- system of record", so this table, not Redis, is authoritative if the
-- cache is ever evicted or restarted.

CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  endpoint         text NOT NULL, -- e.g. 'POST /auth/logout'
  idempotency_key  text NOT NULL,
  response_status  int NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idempotency_keys_uq ON idempotency_keys (tenant_id, endpoint, idempotency_key);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON idempotency_keys TO towos_app;
