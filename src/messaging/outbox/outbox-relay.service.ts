import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import pg from 'pg';
import { TenantService } from '../../common/tenant/tenant.service.js';
import type { EnvironmentVariables } from '../../common/config/environment-variables.js';
import { connectRabbit, publishEvent, RabbitConnection } from '../rabbit.js';

const { Client } = pg;

interface OutboxEventRow {
  id: string;
  tenant_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
}

/**
 * Technical_Reference §3.12's relay, claimed by worker.ts. Event-driven via
 * Postgres LISTEN/NOTIFY (migration 004's trigger), not a poll on a timer -
 * CLAUDE.md invariant #10 rules out the polling option that section also
 * offers ("no bare setInterval in a module").
 *
 * The one query that runs outside TenantService.run() is the cross-tenant
 * "who has pending work" discovery (find_tenant_ids_with_pending_outbox_events,
 * migration 004) - the relay has no tenant of its own, same problem and
 * same SECURITY-DEFINER-function fix as login's tenant discovery. Every
 * row it actually reads or updates after that goes through
 * TenantService.run() for that row's own tenant (CLAUDE.md invariant #2).
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private listener: pg.Client | null = null;
  private rabbit: RabbitConnection | null = null;
  private sweeping = false;
  private sweepAgain = false;

  constructor(
    private readonly tenantService: TenantService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.rabbit = await connectRabbit(this.configService.get('RABBITMQ_URL', { infer: true }));

    this.listener = new Client({
      connectionString: this.configService.get('DATABASE_URL', { infer: true }),
    });
    await this.listener.connect();
    await this.listener.query('LISTEN outbox_events_pending');
    this.listener.on('notification', () => this.triggerSweep());

    // Startup catch-up for rows inserted while the worker was down or
    // between deploys - a one-time check, not a recurring poll.
    this.triggerSweep();
  }

  async onModuleDestroy(): Promise<void> {
    await this.listener?.end();
    await this.rabbit?.close();
  }

  triggerSweep(): void {
    this.sweepUntilQuiet().catch((err: unknown) => {
      this.logger.error(
        `Outbox relay sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async sweepUntilQuiet(): Promise<void> {
    if (this.sweeping) {
      // A sweep is already running; make sure it runs once more after it
      // finishes rather than starting a second one concurrently.
      this.sweepAgain = true;
      return;
    }
    this.sweeping = true;
    try {
      do {
        this.sweepAgain = false;
        await this.sweep();
      } while (this.sweepAgain);
    } finally {
      this.sweeping = false;
    }
  }

  private async sweep(): Promise<void> {
    const tenantRows: { find_tenant_ids_with_pending_outbox_events: string }[] =
      await this.dataSource.query('SELECT * FROM find_tenant_ids_with_pending_outbox_events()');

    for (const row of tenantRows) {
      const tenantId = row.find_tenant_ids_with_pending_outbox_events;
      await this.tenantService.run(tenantId, (manager) => this.processTenantBatch(manager));
    }
  }

  private async processTenantBatch(manager: EntityManager): Promise<void> {
    const rows: OutboxEventRow[] = await manager.query(
      `SELECT id, tenant_id, event_type, entity_type, entity_id, payload
       FROM outbox_events
       WHERE status = 'pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED`,
    );

    for (const row of rows) {
      if (!this.rabbit) {
        throw new Error('Outbox relay is not connected to RabbitMQ');
      }
      try {
        publishEvent(this.rabbit.channel, row.event_type, {
          id: row.id,
          tenant_id: row.tenant_id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          ...row.payload,
        });
        await manager.query(
          `UPDATE outbox_events SET status = 'sent', sent_at = now() WHERE id = $1`,
          [row.id],
        );
      } catch (err) {
        // Outbox -> broker loop (Technical_Reference §3.12): stays pending,
        // retried on the next sweep - not lost, not marked failed here.
        this.logger.warn(
          `Failed to publish outbox event ${row.id}, will retry: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        await manager.query(`UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1`, [
          row.id,
        ]);
      }
    }
  }
}
