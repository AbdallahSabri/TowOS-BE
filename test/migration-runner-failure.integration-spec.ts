import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const migrationsDir = join(repoRoot, 'src', 'database', 'migrations');
const badMigrationPath = join(migrationsDir, '999_deliberately_broken.sql');
const migrateScript = join(repoRoot, 'src', 'database', 'migrate.ts');

function runMigrator(): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--loader', 'ts-node/esm', migrateScript], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'pipe',
    });
    return { exitCode: 0, stdout: stdout.toString(), stderr: '' };
  } catch (err) {
    const e = err as { status: number | null; stdout: Buffer; stderr: Buffer };
    return { exitCode: e.status ?? 1, stdout: e.stdout.toString(), stderr: e.stderr.toString() };
  }
}

/**
 * BE-SPEC §12: "Tests run inside the Coolify build step... The gate is a
 * Coolify pre-start deploy hook that runs pending migrations and fails the
 * deploy on error." Coolify's own mechanics can't be exercised without a
 * real server (see this slice's scope decision), but the actual behavior
 * that gate depends on - src/database/migrate.ts exits non-zero on
 * failure, and does not leave a half-applied migration behind - is fully
 * testable here, against a real Postgres, with a migration file that fails
 * partway through: a valid CREATE TABLE followed by deliberately invalid
 * SQL, both inside the same transaction the real runner wraps every
 * migration in.
 */
describe('Migration runner failure handling (integration)', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
  });

  afterAll(async () => {
    rmSync(badMigrationPath, { force: true });
    await admin.query('DROP TABLE IF EXISTS deliberately_broken_probe');
    await admin.query('DELETE FROM schema_migrations WHERE name = $1', [
      '999_deliberately_broken.sql',
    ]);
    await admin.end();
  });

  it('exits non-zero, applies nothing from the failing migration, and does not record it as applied', async () => {
    writeFileSync(
      badMigrationPath,
      `CREATE TABLE deliberately_broken_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid());\n` +
        `ALTER TABLE deliberately_broken_probe ADD COLUMN this_column_is_fine text;\n` +
        `SELECT * FROM a_table_that_does_not_exist;\n`,
    );

    const result = runMigrator();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/a_table_that_does_not_exist/);

    // "Not deploying halfway": the CREATE TABLE from the same failed
    // migration must not have survived either, even though it's a separate
    // statement that would have succeeded on its own.
    const { rows: tableRows } = await admin.query<{ reg: string | null }>(
      `SELECT to_regclass('public.deliberately_broken_probe') AS reg`,
    );
    expect(tableRows[0].reg).toBeNull();

    const { rows: migrationRows } = await admin.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      ['999_deliberately_broken.sql'],
    );
    expect(migrationRows).toHaveLength(0);
  });

  it('a subsequent real migration run still succeeds once the bad file is removed', () => {
    rmSync(badMigrationPath, { force: true });
    const result = runMigrator();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('migrations complete');
  });
});
