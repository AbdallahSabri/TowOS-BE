import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Migration 005's table - the durable copy behind idempotency-cache.service.ts's
 * Redis fast path (Technical_Reference §1: Redis is never a system of record).
 */
@Injectable()
export class IdempotencyKeyRepository {
  async find(
    manager: EntityManager,
    endpoint: string,
    key: string,
  ): Promise<StoredResponse | undefined> {
    const rows: { response_status: number; response_body: unknown }[] = await manager.query(
      'SELECT response_status, response_body FROM idempotency_keys WHERE endpoint = $1 AND idempotency_key = $2',
      [endpoint, key],
    );
    const row = rows[0];
    return row ? { status: row.response_status, body: row.response_body } : undefined;
  }

  async create(
    manager: EntityManager,
    params: { tenantId: string; endpoint: string; key: string; status: number; body: unknown },
  ): Promise<void> {
    // ON CONFLICT DO NOTHING: two concurrent requests with the same key
    // racing to store their result both succeed here, and whichever won
    // the unique constraint is what every reader (including the loser)
    // sees on the next find() - never an error surfaced to the caller.
    await manager.query(
      `INSERT INTO idempotency_keys (tenant_id, endpoint, idempotency_key, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, endpoint, idempotency_key) DO NOTHING`,
      [params.tenantId, params.endpoint, params.key, params.status, JSON.stringify(params.body)],
    );
  }
}
