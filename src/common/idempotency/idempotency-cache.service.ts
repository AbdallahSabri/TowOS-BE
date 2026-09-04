import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { TenantService } from '../tenant/tenant.service.js';
import { IdempotencyKeyRepository, StoredResponse } from './idempotency-key.repository.js';

const TTL_SECONDS = 24 * 60 * 60; // BE-SPEC §9: "Keys retained 24 hours in Redis"

@Injectable()
export class IdempotencyCacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tenantService: TenantService,
    private readonly repo: IdempotencyKeyRepository,
  ) {}

  private redisKey(tenantId: string, endpoint: string, key: string): string {
    return `idempotency:${tenantId}:${endpoint}:${key}`;
  }

  async find(tenantId: string, endpoint: string, key: string): Promise<StoredResponse | null> {
    const cached = await this.redis.get(this.redisKey(tenantId, endpoint, key));
    if (cached) {
      return JSON.parse(cached) as StoredResponse;
    }

    // Redis miss doesn't mean "never stored" - it may have been evicted or
    // the process restarted. The table is the durable copy.
    return this.tenantService.run(tenantId, async (manager) => {
      const found = await this.repo.find(manager, endpoint, key);
      if (!found) {
        return null;
      }
      await this.redis.set(
        this.redisKey(tenantId, endpoint, key),
        JSON.stringify(found),
        'EX',
        TTL_SECONDS,
      );
      return found;
    });
  }

  async store(
    tenantId: string,
    endpoint: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.tenantService.run(tenantId, (manager) =>
      this.repo.create(manager, { tenantId, endpoint, key, status, body }),
    );
    await this.redis.set(
      this.redisKey(tenantId, endpoint, key),
      JSON.stringify({ status, body }),
      'EX',
      TTL_SECONDS,
    );
  }
}
