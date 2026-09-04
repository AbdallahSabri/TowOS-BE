# Deploy runbook (BE-SPEC §12)

No live Coolify server exists as of this writing, so the Coolify-specific
orchestration below (branch routing, the pre-deployment hook wired up
*inside* Coolify, actual zero-downtime cutover) hasn't been clicked
through or verified against a real instance — treat those as the precise
steps to follow once §15's server setup checklist is done, and verify each
for real. What Coolify actually *builds and runs*, though, has been
verified directly with a real `nixpacks build .` (Nixpacks installed
locally via `brew install nixpacks`, no Coolify needed for this part) and
real containers from that image, against this repo's own docker-compose
test Postgres/Redis/RabbitMQ:

- The image builds via Nixpacks alone, no Dockerfile (§3).
- `docker run --entrypoint node <image> --version` → `v24.10.0` — the
  Node pin in `nixpacks.toml` actually took effect, not just "looks right
  on paper."
- The default start command (`npm run start`) boots the real app in the
  container and serves `GET /health` correctly through the real envelope.
- Overriding the start command to `npm run worker` (a plain
  `--entrypoint sh -c "npm run worker"`, standing in for Coolify's own
  per-application Start Command field) boots `WorkerModule` from the
  *same image* — confirms the "one image, two start commands" model
  actually works, not just that it's architecturally supposed to.
- `npm run migration:run` inside the container connects out to Postgres
  and runs cleanly - the same pre-deployment command below.

One real bug this caught: a stray local `dist/` (with its
`tsconfig.tsbuildinfo` *file* left over from an earlier local `npm run
build`) got copied into the build context and collided with Nixpacks'
auto-generated build-cache *mount* at that same path ("not a directory"),
failing the build outright. Fixed with a `.dockerignore` (Nixpacks
generates and honors an actual Dockerfile, so this works) excluding
`dist/`, `node_modules/`, and other local artifacts — worth knowing since
Coolify normally builds from a fresh clone (unlikely to hit this), but a
local `nixpacks build` for testing will, every time, unless dist/ is clean.

## What's in the repo already

- `nixpacks.toml` — pins Node 24 explicitly for the build (§3), verified above.
- `.dockerignore` — keeps local build artifacts out of the build context.
- `npm run migration:run` — the pre-start migration command (`src/database/migrate.ts`).
  Proven to exit non-zero and apply nothing on a failing migration in
  `test/migration-runner-failure.integration-spec.ts`, and to run cleanly
  from inside the real built container above — that's the actual
  mechanism the pre-deployment hook below depends on.
- `npm run start` / `npm run worker` — the two deployables' start commands.
- `.env.example` — the full list of env vars to set (as **Is Secret** in Coolify, per §11).

## Two Coolify applications, one repo

BE-SPEC §5: "Two deployables, one repo, one image... Coolify runs the same
build with a different start command." Create **two** Coolify
applications, both pointed at this repo:

| Application | Start Command | Replicas | Notes |
|---|---|---|---|
| `towos-api` | `npm run start` (nixpacks.toml default) | as needed | serves HTTP, health check at `GET /health` |
| `towos-worker` | `npm run worker` (override in this app's settings) | **exactly 1** (§5) | outbox relay only, no HTTP |

Both applications:
- Build via Nixpacks (no Dockerfile, §3).
- Get the same env vars (§11's list), marked **Is Secret** for anything
  sensitive — `SESSION_SECRET`, `DATABASE_URL`, `DATABASE_MIGRATION_URL`.
- Get a **Pre-deployment Command** of `npm run migration:run`, using
  `DATABASE_MIGRATION_URL` (the bypass-capable role, never the app's own
  `DATABASE_URL` — BE-SPEC §7). Coolify aborts the deploy and keeps the
  previous container running if this command exits non-zero — that's the
  gate; verify it actually behaves that way on the real server before
  trusting it in production, the same way `migrate.ts`'s own exit-code
  behavior is verified here.
- Only `towos-api` needs the health check (`GET /health`) wired to Uptime
  Kuma (§15) and to Coolify's own container health check.

Running migrations from *both* applications' pre-deployment commands is
deliberate, not a mistake: `migrate.ts` tracks applied migrations in
`schema_migrations` and skips ones already run (proven in every
integration test's `globalSetup`), so whichever of the two deploys first
applies anything pending and the other is a no-op. Do **not** rely on
exactly one of them running the migration — deploy order between the two
apps isn't guaranteed.

## Branch routing (§12's first "known gap")

> Push to `main` deploys production against the prod database. Push to any
> other branch deploys a named preview of the app containers, pointed at
> the shared `dev` database.
>
> Coolify's native preview feature keys off pull requests, not arbitrary
> branch pushes. Decide which behavior you want at setup.

**Decision: branch-push previews, not Coolify's built-in PR-only preview
feature.** BE-SPEC's own wording ("push to any other branch") is broader
than "open a PR" — requiring a PR for every preview would block quick
throwaway branches Coolify's PR-preview feature doesn't cover.

Concretely, until this is automated (see the cleanup job below, which
would need the same API access):

1. `main` → the `towos-api` / `towos-worker` applications above, prod env
   vars, prod database.
2. Any other branch, on first push, gets **its own pair** of Coolify
   applications (`towos-api-preview-<branch-slug>`,
   `towos-worker-preview-<branch-slug>`), same repo, that branch as the
   deploy ref, **dev** database env vars (never prod — the whole point of
   a preview).
3. Every subsequent push to that branch redeploys the same preview pair.

Coolify's webhook-per-application model means step 2 has to be done once
per new branch (manually, or via Coolify's API triggered by a CI step that
detects "first push on this branch") — there's no single Coolify setting
that does this automatically for arbitrary branches the way it does for
PRs. This is exactly the "two known gaps to handle deliberately, not
assume" BE-SPEC flags; don't half-do this and end up with previews that
silently point at prod.

## Preview cleanup (§12's second "known gap")

> The 24-hour preview cleanup is not a Coolify setting. It needs a small
> job that checks last-deploy timestamps and tears down anything stale.

This is **not** built as application code in `src/` — CLAUDE.md invariant
#10 ("no scheduler, anywhere... no bare setInterval in a module") is about
this app's own NestJS modules, not an external ops job. The right home for
it is a cron entry on the Coolify server itself (or a scheduled CI job,
outside this repo's runtime) that:

1. Lists preview applications (by naming convention:
   `*-preview-*`, matching the scheme above).
2. Checks each one's last-deploy timestamp via Coolify's API.
3. Deletes (or stops) any preview pair older than 24 hours since its last
   deploy.

Not written here as code: Coolify's REST API shape wasn't available to
verify against in this session (no live server, per this slice's scope
decision), and shipping an untested API integration presented as working
would be worse than not shipping it. Write it against Coolify's actual API
docs once the server exists, and prove it against a real stale preview
before trusting it to delete anything.

## Rollback

BE-SPEC §12: "Rollback is redeploying a prior successful build from the
Coolify dashboard. It covers the app tier only. A migration that already
ran does not roll back with it." Concretely: if a bad deploy included a
migration, rolling back the app to the previous build does **not** undo
that migration — the expand/contract discipline (BE-SPEC §8) is what makes
running the previous app version against the post-migration schema safe.
Don't roll back a deploy that shipped a contracting (non-additive)
migration without first confirming the previous app version still works
against the new schema.

## What's verified vs. what needs a real server

Verified directly (see above): the image builds correctly via Nixpacks
alone, the Node version pin takes effect, both start commands boot the
right module from the same image, and the migration command runs cleanly
inside the container. Also verified: `migrate.ts` itself exits non-zero
and applies nothing from a failing migration
(`test/migration-runner-failure.integration-spec.ts`).

Still needs a real Coolify server — none of this is a repo/build concern,
it's Coolify's own orchestration on top of a build that's already been
shown to work correctly:

- That a push to `main` actually deploys prod and a push to another branch
  actually produces its own preview.
- That Coolify's Pre-deployment Command field genuinely aborts the deploy
  and keeps the previous container running when the command it runs
  exits non-zero (the command itself is proven to exit non-zero at the
  right time; Coolify's reaction to that exit code is Coolify's behavior,
  not this repo's).
- Actual zero-downtime behavior across a real deploy and rollback.
