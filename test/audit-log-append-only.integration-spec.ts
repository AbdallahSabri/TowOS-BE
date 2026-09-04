import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

/**
 * BE-SPEC §14 / CLAUDE.md invariant #8: audit_log is append-only. The app
 * role has no UPDATE/DELETE on it - enforced at the database (migration
 * 003's REVOKE), not by application-level convention, so this connects as
 * the real towos_app role rather than calling anything through the app.
 */
describe('audit_log append-only (integration)', () => {
  let admin: pg.Client;
  let appRole: pg.Client;
  const tenantId = randomUUID();
  let rowId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      'Audit Log Test Tenant',
    ]);

    appRole = new Client({ connectionString: process.env.DATABASE_URL });
    await appRole.connect();
    await appRole.query('BEGIN');
    await appRole.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const { rows }: { rows: { id: string }[] } = await appRole.query(
      `INSERT INTO audit_log (tenant_id, entity_type, entity_id, action)
       VALUES ($1, 'probe', $1, 'created') RETURNING id`,
      [tenantId],
    );
    rowId = rows[0].id;
    await appRole.query('COMMIT');
  });

  afterAll(async () => {
    await appRole.end();
    await admin.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await admin.end();
  });

  it('the app role can INSERT and SELECT', async () => {
    await appRole.query('BEGIN');
    await appRole.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const { rows } = await appRole.query('SELECT id FROM audit_log WHERE id = $1', [rowId]);
    await appRole.query('COMMIT');
    expect(rows).toHaveLength(1);
  });

  it('the app role cannot UPDATE a row', async () => {
    await appRole.query('BEGIN');
    await appRole.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await expect(
      appRole.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [rowId]),
    ).rejects.toThrow(/permission denied/i);
    await appRole.query('ROLLBACK');
  });

  it('the app role cannot DELETE a row', async () => {
    await appRole.query('BEGIN');
    await appRole.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await expect(appRole.query('DELETE FROM audit_log WHERE id = $1', [rowId])).rejects.toThrow(
      /permission denied/i,
    );
    await appRole.query('ROLLBACK');
  });

  it('the row is unchanged after the rejected attempts', async () => {
    const { rows }: { rows: { action: string }[] } = await admin.query(
      'SELECT action FROM audit_log WHERE id = $1',
      [rowId],
    );
    expect(rows[0].action).toBe('created');
  });
});
