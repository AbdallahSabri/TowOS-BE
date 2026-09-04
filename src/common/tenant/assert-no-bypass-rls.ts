import type { DataSource } from 'typeorm';

interface RoleBypassRow {
  rolbypassrls: boolean;
}

/**
 * BE-SPEC §7.3 / CLAUDE.md invariant #3: the app refuses to boot if its own
 * DB role holds BYPASSRLS - every RLS policy in src/database/migrations
 * would silently stop applying to that role's queries. Checked directly
 * against pg_roles rather than trusting any app-level config, since the
 * actual GRANT/ALTER ROLE state in Postgres is the only source of truth.
 */
export async function assertNoBypassRls(dataSource: DataSource): Promise<void> {
  const rows: RoleBypassRow[] = await dataSource.query(
    'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  const role = rows[0];

  if (!role) {
    throw new Error('Cannot verify BYPASSRLS status: no pg_roles entry for current_user');
  }

  if (role.rolbypassrls) {
    throw new Error(
      'Refusing to start: the application database role has BYPASSRLS. ' +
        'Row-level security would not apply to any query it runs (BE-SPEC §7.3).',
    );
  }
}
