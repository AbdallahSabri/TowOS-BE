// Runs before any test module loads AppModule/WorkerModule, so config
// validation (BE-SPEC §11) sees a complete, well-formed environment.
// These are throwaway values - Phase 0 has no database code yet.
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3000';
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/towos_test';
process.env.DATABASE_MIGRATION_URL ??= 'postgres://migrator:pass@localhost:5432/towos_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RABBITMQ_URL ??= 'amqp://localhost:5672';
process.env.SESSION_SECRET ??= 'test-only-session-secret-at-least-32-chars';
process.env.LOG_LEVEL ??= 'silent';
