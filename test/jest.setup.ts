// Runs before any test module loads AppModule/WorkerModule, so config
// validation (BE-SPEC §11) sees a complete, well-formed environment.
// DATABASE_URL/DATABASE_MIGRATION_URL default to docker-compose.test.yml's
// Postgres (`docker compose -f docker-compose.test.yml up -d`) - AppModule
// now boots a real DB connection via TenantModule, so the suite needs one.
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3000';
process.env.DATABASE_URL ??= 'postgres://towos_app:towos_app@localhost:5433/towos_test';
process.env.DATABASE_MIGRATION_URL ??= 'postgres://postgres:postgres@localhost:5433/towos_test';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.RABBITMQ_URL ??= 'amqp://localhost:5673';
process.env.SESSION_SECRET ??= 'test-only-session-secret-at-least-32-chars';
process.env.LOG_LEVEL ??= 'silent';
