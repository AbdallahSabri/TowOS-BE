import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, 'migrations');

/**
 * BE-SPEC §8: plain SQL files, hand-written, numbered, run in order, tracked
 * so a repeat run only applies what's new. Runs under DATABASE_MIGRATION_URL
 * (the bypass-capable role, BE-SPEC §7) - never DATABASE_URL, and never used
 * by the running app itself. This is the script Coolify's pre-start deploy
 * hook invokes (npm run migration:run).
 */
async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) {
    throw new Error('DATABASE_MIGRATION_URL is required to run migrations');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if (rows.length > 0) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

run()
  .then(() => console.log('migrations complete'))
  .catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
