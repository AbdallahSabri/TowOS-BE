import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
// Inside the repo (not os.tmpdir()) so Node's upward node_modules lookup
// finds the real one, and its upward package.json lookup finds the repo
// root's "type": "module" - both needed for the compiled output to run.
// Gitignored; wiped clean before and after this file's tests.
const outDir = join(repoRoot, '.jest-boot-probe');
const probePath = join(outDir, 'test', 'support', 'boot-probe.js');

/**
 * BE-SPEC §7.3 / CLAUDE.md invariant #3: the app refuses to boot if its own
 * DB role holds BYPASSRLS. Proven here by actually granting it to the real
 * app role and spawning the real app (test/support/boot-probe.ts, which
 * boots the same AppModule graph as src/main.ts) - this is "confirms the app
 * refuses to start" taken literally, not a stand-in for it.
 *
 * Compiled with plain tsc into a throwaway dir rather than run through
 * `--loader ts-node/esm`: that loader mis-resolves a `.js` import inside
 * @nestjs/config's already-compiled dist (doubles the extension to `.js.js`)
 * when it's registered globally like this, even though the exact same code
 * runs fine as `node dist/main.js` (no loader involved) - a ts-node/esm
 * resolution bug, not an issue with our code. A real compiled build sidesteps
 * it entirely, matching how the app actually ships.
 */
describe('BYPASSRLS startup assertion (integration)', () => {
  const dbUrlBase = process.env.DATABASE_URL ?? '';

  beforeAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'tsc'),
      ['-p', 'tsconfig.json', '--outDir', outDir],
      { cwd: repoRoot },
    );
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const bootApp = () => {
    try {
      const stdout = execFileSync(process.execPath, [probePath], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'pipe',
        timeout: 15_000,
      });
      return { exitCode: 0, stderr: '', stdout: stdout.toString() };
    } catch (err) {
      const e = err as { status: number | null; stderr: Buffer; stdout: Buffer };
      return { exitCode: e.status, stderr: e.stderr.toString(), stdout: e.stdout.toString() };
    }
  };

  afterEach(async () => {
    const admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('ALTER ROLE towos_app NOBYPASSRLS');
    await admin.end();
  });

  it('boots normally when the app role does not have BYPASSRLS', () => {
    const result = bootApp();
    expect(result.exitCode).toBe(0);
  });

  it('refuses to start when the app role has BYPASSRLS', async () => {
    const admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('ALTER ROLE towos_app BYPASSRLS');
    await admin.end();

    const result = bootApp();

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/BYPASSRLS/);
  });

  // Sanity check that dbUrlBase parsed at all - guards against a silently
  // empty DATABASE_URL making both cases above pass for the wrong reason.
  it('is running against a real DATABASE_URL', () => {
    expect(dbUrlBase).toMatch(/^postgres:\/\//);
  });
});
