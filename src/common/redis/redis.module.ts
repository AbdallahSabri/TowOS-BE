import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Redis } from 'ioredis';
import type { EnvironmentVariables } from '../config/environment-variables.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * One shared connection - Technical_Reference §1: Redis is "cache and rate
 * limiting only... never a system of record". common/idempotency/ uses it
 * as the fast path in front of migration 005's table; common/ratelimit/
 * (Phase 0 login rate limiting, not built in this slice) will use the same
 * client rather than opening its own.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true })),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    await client?.quit();
  }
}
