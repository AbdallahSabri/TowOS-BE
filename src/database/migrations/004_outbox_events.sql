-- BE-SPEC §8, migration 004: outbox_events.
--
-- Column shapes from TowOS_Technical_Reference.md §3.12, with company_id ->
-- tenant_id (see 001). Written in the same transaction as the business
-- mutation it describes (CLAUDE.md invariant #5) - Phase 0 has no such
-- mutation yet (no Job/Dispatch models), so this migration is pure
-- infrastructure, exercised by messaging/outbox/'s relay and its tests.
--
-- CLAUDE.md invariant #10: no scheduler, anywhere - no bare setInterval in
-- a module. The relay does not poll outbox_pending_idx on a timer (one of
-- the two options Technical_Reference §3.12 offers); it LISTENs on the
-- notify_outbox_events channel a trigger below NOTIFYs on, which is
-- event-driven, not a scheduler.

CREATE TYPE outbox_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE outbox_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  event_type  text NOT NULL, -- 'job.status_changed', 'dispatch.assigned', etc. - TowOS_MVP.md §7.4
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  payload     jsonb NOT NULL,
  status      outbox_status NOT NULL DEFAULT 'pending',
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (created_at) WHERE status = 'pending';

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON outbox_events TO towos_app;

CREATE FUNCTION notify_outbox_events_pending() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_events_pending', NEW.id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_events_notify
  AFTER INSERT ON outbox_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_outbox_events_pending();

-- The relay is a background worker with no single tenant of its own - it
-- has to discover which tenants have pending work before it can process
-- any of it, and outbox_events' own RLS policy needs current_tenant_id()
-- already set to see anything at all. Same bootstrapping problem, same
-- fix, as migration 002's find_tenant_ids_for_email: a narrow SECURITY
-- DEFINER function, owned by the migration role (not towos_app), that
-- returns tenant ids only. Every actual row read/update after that runs
-- through TenantService.run() for that specific tenant (CLAUDE.md
-- invariant #2), never through this function's elevated context.
CREATE FUNCTION find_tenant_ids_with_pending_outbox_events() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT DISTINCT tenant_id FROM outbox_events WHERE status = 'pending'
$$;
REVOKE ALL ON FUNCTION find_tenant_ids_with_pending_outbox_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_tenant_ids_with_pending_outbox_events() TO towos_app;
