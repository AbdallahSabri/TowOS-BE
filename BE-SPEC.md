# TowOS — BE Spec (Phase 0 Bootstrap)

**Repo:** `towos-api`
**Scope:** Phase 0 only (build plan §12). Repo scaffold, dependencies, folder structure, config, conventions, and the minimum runtime that lets a user log in.
**Source of truth:** `TowOS_MVP.md` v0.7 and `TowOS_Technical_Reference.md`. Where this file and those disagree, those win, **except for the version table in §2**, which supersedes ADR-001 and ADR-003.
**Out of scope here:** Call/Job/Dispatch models, state machines, board queries, Swoop adapter, exports. Those are Phase 1 and 2.
**Companion:** `FE-SPEC.md`.

---

## 1. Phase 0 exit condition

One statement: **a user logs in against a deployed instance, and every request that touches a business table is already tenant-scoped by Postgres.**

Everything below exists to make that true without retrofitting later.

---

## 2. Versions

Checked 3 September 2026. Pin these exactly. Re-check before Phase 1 starts.

| Component | Pin | Status | Notes |
|---|---|---|---|
| Node.js | **24.x** | Active LTS since Oct 2025 | Enters maintenance 20 Oct 2026, EOL Apr 2028. Node 26 becomes Active LTS in late Oct 2026 — plan that bump for Phase 1, not Phase 0. **Supersedes ADR-003's Node 22**, which is already in maintenance. |
| NestJS | **12.0.1** | Released 27 Aug 2026 | **Read §2.1 before pinning this.** |
| TypeScript | 5.x | | Next.js rejects TS 7.0+ on some lines. Hold at 5.x across both repos so FE and BE stay on one compiler. |
| PostgreSQL | **18.6** | Current major | PG 19 is at Beta 3 with GA expected this month. Stay on 18: RDS lags community GA by months, and the prod database moves to RDS in weeks 9–10. |
| RabbitMQ | **4.3.x** (4.3.5) | Current series | Requires **Erlang 27.0 or later**. Nodes refuse to start on older Erlang. Check what the Coolify one-click template ships before assuming. |
| Redis | 8.x | | Cache and rate limiting only. No persistence requirement in Phase 0. |

### 2.1 NestJS 12 carries a real decision

NestJS 12 moved the core packages **from CommonJS to ESM**. It shipped one week ago.

That matters here because this stack leans on decorator-heavy TypeORM entities, `reflect-metadata`, and a worker entrypoint sharing the same build. ESM changes module resolution, how `ts-node` and Jest are configured, and how any CommonJS-only dependency behaves.

Two options:

- **Pin 12.0.1.** Correct call if you want the newest platform and are willing to spend Phase 0 time on ESM config. Phase 0 is the cheapest moment to eat this, since there are three modules and no business logic yet.
- **Pin 11.1.28.** The mature line. Move to 12 during Phase 3 hardening once the ecosystem has caught up.

**My read: pin 12.0.1, and treat "TypeORM entities, migrations, and Jest all run clean under ESM" as a Phase 0 exit gate.** If that gate fails in the first few days, drop to 11.1.28 and move on. Discovering an ESM incompatibility in Phase 1 with the dispatch models half-built is the outcome worth avoiding.

Decide this before writing the first migration, not after.

---

## 3. Stack

| Concern | Choice | Locked by |
|---|---|---|
| Runtime | Node 24 LTS | §2 |
| Language | TypeScript 5.x, strict mode | ADR-003 |
| Framework | NestJS 12, Express adapter | ADR-004, §2.1 |
| ORM | TypeORM | ADR-004 |
| Validation | class-validator + class-transformer via Nest pipes | ADR-004 |
| Database | PostgreSQL 18 | ADR-001 |
| Cache / rate limit | Redis | ADR-001 |
| Queue | RabbitMQ 4.3 | ADR-001 |
| Hosting | Coolify, Nixpacks build, no Dockerfile | ADR-010 |

No Dockerfile in this repo. Coolify builds it. Set the Node version explicitly through Nixpacks configuration so the build does not drift to whatever the builder defaults to.

---

## 4. Dependencies

**Runtime**

```
@nestjs/common@12 @nestjs/core@12 @nestjs/platform-express@12 @nestjs/config
@nestjs/typeorm typeorm pg
class-validator class-transformer
argon2
ioredis
amqplib
nestjs-pino pino pino-http
cookie-parser helmet
ulid
```

**Dev**

```
@nestjs/cli@12 @nestjs/testing@12 @nestjs/schematics@12
typescript@5 ts-node tsconfig-paths
jest ts-jest supertest @types/*
eslint @typescript-eslint/* eslint-plugin-import
prettier
dependency-cruiser
```

Pin exact versions in `package.json`. No `^` ranges on anything in the runtime list.

Not installed in Phase 0: `@nestjs/schedule` (there is no scheduler anywhere in this system, ADR-012), any SMS or email SDK, any payment SDK, any AI or model SDK. Adding one of these is a spec change, not a dependency decision.

---

## 5. Folder structure

```
towos-api/
├── src/
│   ├── main.ts                  API entrypoint
│   ├── worker.ts                worker entrypoint (second deployable, same image)
│   ├── app.module.ts
│   ├── worker.module.ts
│   ├── common/
│   │   ├── envelope/            response interceptor: { data, meta, request_id }
│   │   ├── errors/              exception filter, error codes enum (§7.2)
│   │   ├── idempotency/         guard + Redis-backed key store
│   │   ├── tenant/              AsyncLocalStorage tenant context + transaction wrapper
│   │   ├── logging/             pino config, PII allowlist
│   │   ├── ratelimit/           Redis token bucket
│   │   └── audit/               audit-log writer, called inside the transaction wrapper
│   ├── database/
│   │   ├── data-source.ts
│   │   ├── migrations/          plain SQL, numbered, hand-written
│   │   └── rls/                 policy helpers, SET LOCAL wrapper
│   ├── messaging/
│   │   ├── rabbit.ts            connection, channel, publisher
│   │   └── outbox/              relay process, claimed by worker.ts
│   └── modules/
│       └── identity/            users, sessions, roles, permissions
├── test/
├── .env.example
├── .dependency-cruiser.js
├── eslint.config.mjs
└── BE-SPEC.md
```

`modules/fleet`, `modules/intake`, `modules/dispatching`, `modules/integration`, `modules/export` do not exist yet. Phase 1 creates them.

**Two deployables, one repo, one image.** `main.ts` starts the HTTP API. `worker.ts` starts the outbox relay and, from Phase 2, the Swoop poll task and ingestion consumer. Coolify runs the same build with a different start command. Worker replica count is exactly 1 (§8.2).

---

## 6. Module boundary rule

A module may import from `common/`, `database/`, `messaging/`, and its own tree. It may not import from another module's internals, only from that module's exported service interface. No cross-module table reads.

Enforce with `dependency-cruiser`, run in the test step so a violation fails the build. `eslint-plugin-import` handles path hygiene. PR review is the backstop, not the mechanism.

---

## 7. Tenancy and RLS

Non-negotiable from the first migration (ADR-008).

1. Every business table carries `tenant_id`, not null.
2. Every business table has an RLS policy filtering on `current_setting('app.tenant_id')`.
3. The application database role holds no `BYPASSRLS`. **The app asserts this at startup and refuses to boot if it does.**
4. Tenant context is set in exactly one place: a transaction wrapper in `common/tenant/` that issues `SET LOCAL app.tenant_id` before any query. No call site sets it directly.
5. The outbox relay and every worker job run inside that same wrapper with an explicit tenant, or under an explicitly justified elevated role with a comment naming the reason.
6. Every request logs its tenant context, so an empty result set is traceable in one step (RISK-08).

Migrations run under a role that may bypass policies. That role is separate from the application role and is never used by the running app.

---

## 8. Migrations

Plain SQL files under `src/database/migrations/`, hand-written, numbered, in version control. **TypeORM's migration generator is never the source of truth.** Generate to read the diff, then write the SQL yourself.

Expand/contract discipline: every migration is backward-compatible with the previous release for one deploy cycle.

The gate is a Coolify pre-start deploy hook that runs pending migrations and fails the deploy on error. There is no separate CI system.

**Phase 0 migrations:**

| # | Creates |
|---|---|
| 001 | `tenants`, `locations` (with IANA `timezone`), RLS policies on both |
| 002 | `users`, `sessions`, role enum (`admin`, `dispatcher` only) |
| 003 | `audit_log`, append-only: `REVOKE UPDATE, DELETE` from the app role |
| 004 | `outbox_events` |
| 005 | idempotency key store, unique on `(tenant_id, endpoint, idempotency_key)` |

Column-level detail comes from `TowOS_Technical_Reference.md` §3. Do not invent it here.

---

## 9. Cross-cutting conventions

**Response envelope.** Every 2xx returns `{ data, meta, request_id }`. A global interceptor does this. No controller builds it by hand.

**Errors.** Global exception filter emits the §7.2 shape. Error codes live in one enum. A thrown error with no code maps to `INTERNAL_ERROR` and logs at error level.

**Request ID.** ULID, generated at middleware, attached to the log context and every response.

**Idempotency.** A guard rejects any state-changing POST without an `Idempotency-Key` header, returning 400 `VALIDATION_FAILED`. A repeat of a stored key returns the original response body and status, and writes nothing. Keys retained 24 hours in Redis, backed by the table from migration 005. Wire the guard in Phase 0 even though Phase 0 has no state-changing POST besides login, so Phase 1 inherits it rather than adding it.

**Rate limiting.** Redis token bucket in `common/ratelimit/`. Phase 0 applies it to login only. Phase 2 reuses it for the Swoop trigger at 1 per tenant per minute.

**Audit.** `common/audit/` writes an `audit_log` row inside the same transaction as the mutation it describes. Same for the `outbox_events` row. Both or neither (§6.3).

**Logging.** pino, structured, one line per request. **Explicit allowlist of loggable fields.** No customer name, phone, email, address, plate, or VIN reaches a log. IDs only. Credentials never appear in a log, a response, or an error message.

**Timestamps.** UTC in the database, always. Never a naive timestamp. Nothing in this repo derives a timezone from coordinates; it comes from the job's Location and only from there (§5.3).

---

## 10. Auth (the one feature Phase 0 ships)

This is **user authentication into TowOS**, owned by `identity`. Provider credentials for Swoop and any second motor club are a separate concern owned by `integration`, and they arrive in Phase 2. Nothing in this section touches them.

- Passwords: argon2id. Minimum 10 characters, checked against a breach list on set.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, 12h rolling. One session type.
- No SSO, no MFA. Phase 6.
- Two roles, `admin` and `dispatcher`. Creating a user with any other role is rejected at the API and impossible at the database.
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`.
- Invalid password returns 401 with no user enumeration.

Permissions matrix from §6.5 is encoded as data and tested cell by cell.

---

## 11. Configuration

`@nestjs/config`, validated at boot with class-validator. **The app fails to start on a missing or malformed variable.** No defaults for anything security-relevant.

```
NODE_ENV
PORT
DATABASE_URL
DATABASE_MIGRATION_URL        separate role, migrations only
REDIS_URL
RABBITMQ_URL
SESSION_SECRET                Is Secret
SESSION_TTL_HOURS=12
LOG_LEVEL
```

Every secret is a Coolify per-application environment variable marked **Is Secret**. No `.env` file committed. Nothing baked into an image. `.env.example` holds names and empty values only.

Phase 2 adds provider credentials. Phase 1 adds S3 and Google Maps keys. Do not add placeholders for them now.

---

## 12. Deploy

Push to `main` deploys production against the prod database. Push to any other branch deploys a named preview of the app containers, pointed at the shared `dev` database.

Tests run inside the Coolify build step. A failing test blocks the deploy. There is no external pipeline.

Two known gaps to handle deliberately, not assume (DevOps Diagram 2):

- Coolify's native preview feature keys off pull requests, not arbitrary branch pushes. Decide which behavior you want at setup.
- The 24-hour preview cleanup is not a Coolify setting. It needs a small job that checks last-deploy timestamps and tears down anything stale.

Rollback is redeploying a prior successful build from the Coolify dashboard. It covers the app tier only. A migration that already ran does not roll back with it.

---

## 13. Guards against reintroducing cut scope

Write these as tests or lint rules in Phase 0, before there is anything to catch. They are cheap now and expensive to retrofit.

| Guard | Fails the build if |
|---|---|
| No money | Any migration adds a `numeric`/`money` column, or any DTO field name matches price, amount, total, invoice, payment, rate |
| No AI | Any response type or column named score, rank, confidence, risk_level, model_version, predicted_* |
| No driver role | The role enum has any value besides `admin` and `dispatcher` |
| No notifications | Any import of an SMS, email, or push SDK |
| No scheduler | Any import of `@nestjs/schedule`, `node-cron`, or `setInterval` in a module |
| No BYPASSRLS | Startup assertion on the application role |
| Boundaries | A cross-module internal import |

---

## 14. Phase 0 Definition of Done

- [ ] **TypeORM entities, plain-SQL migrations, and the Jest suite all run clean under the chosen NestJS module format (§2.1).** Settle this before migration 001.
- [ ] A user logs in and receives an HttpOnly session cookie. An invalid password returns 401 with no user enumeration.
- [ ] A session expires at its TTL and returns `SESSION_EXPIRED`.
- [ ] Both roles are verified against every cell of the §6.5 matrix by an automated test.
- [ ] Creating a user with a `driver` role is rejected.
- [ ] With two tenants seeded, every endpoint returns only the calling tenant's rows.
- [ ] A query issued with no tenant context returns zero rows, never another tenant's.
- [ ] The app refuses to start when the database role holds `BYPASSRLS`.
- [ ] The outbox relay processes rows under an explicit tenant context, verified by an integration test.
- [ ] A POST with no `Idempotency-Key` returns 400 `VALIDATION_FAILED`; a repeated key returns the original response and writes one row.
- [ ] `UPDATE` and `DELETE` on `audit_log` fail for the application role.
- [ ] A log scan across a day of traffic finds zero customer phone numbers, emails, or addresses, and zero credentials.
- [ ] A migration deploy and a rollback complete with zero downtime.
- [ ] `main` deploys to production and a branch deploys to its own preview, both from a git push.

---

## 15. Server setup checklist (Phase 0, not code)

Track separately from the repo but complete in the same phase.

- [ ] Coolify control plane on its own small server, separate from the app server (ADR-010, ~$5/mo)
- [ ] Non-root deploy user, restricted SSH, firewall. Coolify runs as root by default and hardening is manual (RISK-18)
- [ ] PostgreSQL 18.6, `prod` and `dev` as two databases
- [ ] Redis 8
- [ ] RabbitMQ 4.3.x with durable queues and persistent messages. **Confirm the Coolify template ships Erlang 27 or later, or the node will not start.** Confirm durability at setup, not after a broker restart loses data
- [ ] Sentinel enabled
- [ ] Uptime Kuma deployed, health check against the API
- [ ] Notification channel wired to both engineers

Phase A has no disaster recovery, by decision (RISK-17). Treat anything on this server as unrecoverable until the prod database moves to RDS in weeks 9 to 10.

**Confirm before the RDS migration:** RDS supports PostgreSQL 18 at the version you need. Community GA and RDS availability are months apart, and this is a hard gate before dual-run starts.