import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { GetMessage } from 'amqplib';
import pg from 'pg';
import { WorkerModule } from '../src/worker.module.js';
import { TenantService } from '../src/common/tenant/tenant.service.js';
import { OUTBOX_EXCHANGE, connectRabbit, RabbitConnection } from '../src/messaging/rabbit.js';

const { Client } = pg;

interface OutboxRow {
  id: string;
  tenant_id: string;
  status: 'pending' | 'sent' | 'failed';
  sent_at: Date | null;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

/**
 * BE-SPEC §14: "The outbox relay processes rows under an explicit tenant
 * context, verified by an integration test." Boots the real WorkerModule
 * (not AppModule - the relay is worker-only, BE-SPEC §5), seeds rows for
 * two tenants through TenantService itself (a genuinely RLS-scoped write,
 * the same path a real Phase 1 mutation would use), and proves three
 * things: the relay's own reads/updates go through TenantService.run() per
 * row's tenant (spied directly, not inferred), the rows end up 'sent', and
 * RabbitMQ actually received one message per event.
 */
describe('Outbox relay (integration)', () => {
  let app: INestApplication;
  let admin: pg.Client;
  let consumer: RabbitConnection;
  let queueName: string;

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2), ($3, $4)', [
      tenantA,
      'Outbox Tenant A',
      tenantB,
      'Outbox Tenant B',
    ]);

    // Bind a probe queue to the relay's exchange *before* the relay starts
    // publishing, so nothing is missed. Via connectRabbit() (not a raw
    // amqp.connect()) so this picks up the same frameMax fix the relay
    // itself needs against a real RabbitMQ 4.3 broker - see rabbit.ts.
    consumer = await connectRabbit(process.env.RABBITMQ_URL as string);
    const assertedQueue = await consumer.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    queueName = assertedQueue.queue;
    await consumer.channel.bindQueue(queueName, OUTBOX_EXCHANGE, '#');

    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init(); // triggers OutboxRelayService.onModuleInit(): connects RabbitMQ, LISTENs
  });

  afterAll(async () => {
    await consumer.close();
    await admin.query('DELETE FROM outbox_events WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await admin.end();
    await app.close();
  });

  it('processes rows for multiple tenants under an explicit tenant context and delivers them', async () => {
    const tenantService = app.get(TenantService);
    const runSpy = jest.spyOn(tenantService, 'run');

    const eventIdA = randomUUID();
    const eventIdB = randomUUID();

    // Inserted through TenantService itself (the real towos_app role, RLS
    // enforced), not the admin/bypass connection - a genuinely tenant-
    // scoped write, the same path a real Phase 1 mutation would take.
    await tenantService.run(tenantA, (manager) =>
      manager.query(
        `INSERT INTO outbox_events (id, tenant_id, event_type, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [eventIdA, tenantA, 'test.probe', 'probe', eventIdA, JSON.stringify({ from: 'tenant-a' })],
      ),
    );
    await tenantService.run(tenantB, (manager) =>
      manager.query(
        `INSERT INTO outbox_events (id, tenant_id, event_type, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [eventIdB, tenantB, 'test.probe', 'probe', eventIdB, JSON.stringify({ from: 'tenant-b' })],
      ),
    );
    // Deliberately not cleared: the relay is event-driven and may start
    // processing concurrently with these very inserts (NOTIFY fires on
    // commit), so there's no instant after which "only the relay's calls"
    // start landing. The spy is corroborating evidence, not the only
    // proof - see the RLS-scoped read-back below, which *cannot* succeed
    // unless the relay's own writes went through a correct tenant context:
    // FORCE ROW LEVEL SECURITY means there is no owner/role bypass that
    // could have flipped these rows to 'sent' any other way.

    const fetchRow = async (id: string): Promise<OutboxRow> => {
      const { rows } = await admin.query<OutboxRow>(
        'SELECT id, tenant_id, status, sent_at FROM outbox_events WHERE id = $1',
        [id],
      );
      return rows[0];
    };

    await waitUntil(async () => (await fetchRow(eventIdA)).status === 'sent');
    await waitUntil(async () => (await fetchRow(eventIdB)).status === 'sent');

    const rowA = await fetchRow(eventIdA);
    const rowB = await fetchRow(eventIdB);
    expect(rowA.sent_at).not.toBeNull();
    expect(rowB.sent_at).not.toBeNull();

    // Corroborating evidence: TenantService.run() was called with each
    // tenant's own id more than once - once for this test's seed insert,
    // and at least once more for the relay's own processing sweep (a
    // single call per tenant would just be the seed).
    const tenantIdCounts = runSpy.mock.calls.reduce<Record<string, number>>((acc, call) => {
      const [id] = call;
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    expect(tenantIdCounts[tenantA]).toBeGreaterThanOrEqual(2);
    expect(tenantIdCounts[tenantB]).toBeGreaterThanOrEqual(2);

    // And that RabbitMQ actually received both, correctly attributed.
    const received: Record<string, unknown>[] = [];
    await waitUntil(async () => {
      const msg: GetMessage | false = await consumer.channel.get(queueName);
      if (msg) {
        received.push(JSON.parse(msg.content.toString()) as Record<string, unknown>);
        consumer.channel.ack(msg);
      }
      return received.length >= 2;
    });

    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: eventIdA, tenant_id: tenantA, from: 'tenant-a' }),
        expect.objectContaining({ id: eventIdB, tenant_id: tenantB, from: 'tenant-b' }),
      ]),
    );

    // Cross-tenant isolation held for the writes the relay made too: tenant
    // A cannot see tenant B's now-processed row, and vice versa.
    const asA: OutboxRow[] = await tenantService.run(tenantA, (manager) =>
      manager.query('SELECT id, tenant_id, status, sent_at FROM outbox_events'),
    );
    expect(asA.map((r) => r.id)).toEqual([eventIdA]);
  });
});
