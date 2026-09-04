import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Applies migrations 001-003 once before the suite runs (skips ones already
// applied - see src/database/migrate.ts). Runs the real migration script,
// under real Node ESM (not Jest's sandbox), exactly as Coolify's deploy hook
// would - not a reimplementation of it.
export default function globalSetup() {
  const migrationUrl =
    process.env.DATABASE_MIGRATION_URL ??
    'postgres://postgres:postgres@localhost:5433/towos_test';

  execFileSync(
    process.execPath,
    ['--loader', 'ts-node/esm', join(__dirname, '..', 'src/database/migrate.ts')],
    {
      cwd: join(__dirname, '..'),
      env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
      stdio: 'inherit',
    },
  );
}
