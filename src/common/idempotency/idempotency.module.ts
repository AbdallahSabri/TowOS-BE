import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RedisModule } from '../redis/redis.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { IdempotencyKeyRepository } from './idempotency-key.repository.js';
import { IdempotencyCacheService } from './idempotency-cache.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

@Module({
  imports: [RedisModule, TenantModule],
  providers: [
    IdempotencyKeyRepository,
    IdempotencyCacheService,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
