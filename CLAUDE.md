# CLAUDE.md — towos-api

TowOS backend. NestJS API + a worker deployable, one Postgres, multi-tenant via RLS. Read `BE-SPEC.md` for anything not covered here — this file is the invariant list, not the spec.

**Current phase: Phase 0 only.** No Call/Job/Dispatch models, no state machines, no Swoop adapter, no exports. If a task seems to need one of those, stop and say so instead of building it.

---

## Versions — do not substitute

Node 24.x · NestJS 12.0.1 · TypeScript 5.x · PostgreSQL 18.6 · RabbitMQ 4.3.x (needs Erlang 27+) · Redis 8.x

Full rationale in `BE-SPEC.md` §2. **NestJS 12 is ESM.** If TypeORM entities, migrations, or Jest fail to run clean under ESM, stop and flag it — the fallback is pinning 11.1.28, not fighting the build config unattended.

---

## Non-negotiable invariants

These are correct by construction elsewhere in this project. Do not "simplify" them, even if a task seems to work without them.

1. **Every business table has `tenant_id` and an RLS policy.** No exceptions, no "I'll add RLS later."
2. **Tenant context is set in exactly one place** — the transaction wrapper in `common/tenant/`. Never call `SET LOCAL app.tenant_id` from anywhere else.
3. **The app refuses to boot if the DB role holds `BYPASSRLS`.** Don't remove this check to make local dev easier.
4. **Migrations are hand-written plain SQL**, numbered, in `src/database/migrations/`. TypeORM's generator is a diff-reading tool, never the committed migration.
5. **Every mutation writes an audit_log row and an outbox_events row in the same transaction.** Both or neither.
6. **Every state-changing POST requires `Idempotency-Key`.** A repeated key returns the original response and writes nothing new.
7. **No cross-module table reads.** A module calls another module's exported service, never its repository directly.
8. **`audit_log` is append-only.** The app role has no `UPDATE`/`DELETE` on it.
9. **Nothing logs PII.** Structured logging, explicit allowlist, IDs only. Credentials never appear in a log, response, or error message.
10. **No scheduler, anywhere.** No `@nestjs/schedule`, no `node-cron`, no bare `setInterval` in a module. Everything Swoop-related is dispatcher-triggered (ADR-012) — this is a Phase 2 concern but the rule starts now.

## Cut-scope guards — treat these as trip-wires

If you're about to write code that touches one of these, stop and confirm scope first:

| Touching this | Means |
|---|---|
| A `numeric`/`money` column, or a field named price/amount/total/invoice/payment/rate | Out of scope — no money handling, ADR-009 |
| A field named score/rank/confidence/risk_level/model_version/predicted_* | Out of scope — no AI, ADR-013 |
| A role value besides `admin` or `dispatcher` | Out of scope — no driver role, ADR-006 |
| An SMS/email/push SDK import | Out of scope — no notifications, §8.5 |
| A Swoop credential or adapter | Not yet — that's Phase 2, `integration` module |

## Response and error shape

Every 2xx: `{ data, meta, request_id }`, built once by a global interceptor — controllers never build this by hand. Errors follow the `{ error: { code, message, details, request_id } }` shape in `BE-SPEC.md` §7.2 (referenced from `TowOS_MVP.md`). Error codes live in one enum.

## Commands

```
npm run build            # nest build -> dist/ (includes copying src/database/migrations/*.sql)
npm run start             # node dist/main.js
npm run start:dev         # nest start --watch
npm run worker             # node dist/worker.js
npm run worker:dev         # nest start --watch --entryFile worker
npm run migration:run      # node dist/database/migrate.js — plain-SQL runner, uses DATABASE_MIGRATION_URL, never DATABASE_URL
npm test                   # jest — needs a real reachable Postgres, see below
npm run test:watch
npm run lint                # eslint src/ test/
npm run lint:boundaries     # dependency-cruiser — enforces the §6 module boundary rule
npm run format               # prettier --write
```

`npm test` requires a real Postgres, Redis, and RabbitMQ reachable at `DATABASE_URL`/`DATABASE_MIGRATION_URL`/`REDIS_URL`/`RABBITMQ_URL` (defaults in `test/jest.setup.ts` point at `docker-compose.test.yml`'s instances on ports 5433/6380/5673 — `docker compose -f docker-compose.test.yml up -d` once, then `npm test`). AppModule boots real DB/Redis connections via `TenantModule`/`IdempotencyModule`, and the outbox relay tests boot `WorkerModule` (real RabbitMQ), so none of this is optional. Jest's `globalSetup` (`test/global-setup.js`) applies pending migrations before the suite runs.

RabbitMQ 4.3 rejects amqplib's default `frame_max` (4096 < its enforced minimum of 8192) — `messaging/rabbit.ts`'s `connectRabbit()` sets it via the connection URL's query string (not `connect()`'s second argument, which is unrelated socket options). Any new direct `amqp.connect()` call (tests included) needs the same fix or the connection silently fails with "Socket closed abruptly during opening handshake."

## When to stop and ask instead of proceeding

- The NestJS 12 ESM question (§2.1) — resolve this once, early, don't rediscover it mid-slice.
- Anything the spec marks `[NEEDS TONY]` — don't invent the answer, leave a `TODO` citing the question number from `TowOS_MVP.md` §15.
- Any edit to `common/tenant/` — this is the single highest-blast-radius file in the repo.