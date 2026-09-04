import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

/**
 * BE-SPEC §10 / §14: creating a user with any role besides admin or
 * dispatcher is impossible at the database - the user_role enum itself
 * (migration 002) does not have a value for it, so this isn't a validation
 * rule that could be bypassed, it's a type Postgres itself doesn't have.
 * There is no create-user HTTP endpoint in Phase 0 (BE-SPEC §10 lists only
 * login/logout/me/password), so this is the enforcement point.
 */
describe('user_role enum (integration)', () => {
  let admin: pg.Client;
  const tenantId = randomUUID();

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      'Enum Test Tenant',
    ]);
  });

  afterAll(async () => {
    await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await admin.end();
  });

  it.each(['owner', 'manager', 'driver', 'readonly', 'superadmin'])(
    'rejects role %s at the database',
    async (role) => {
      await expect(
        admin.query(
          `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, `${role}@example.test`, 'Rejected Role', 'x', role],
        ),
      ).rejects.toThrow(/invalid input value for enum user_role/);
    },
  );

  it('accepts admin and dispatcher', async () => {
    await admin.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin'), ($1, $5, $3, $4, 'dispatcher')`,
      [tenantId, 'accepted-admin@example.test', 'Accepted Role', 'x', 'accepted-dispatcher@example.test'],
    );
    const { rows } = await admin.query('SELECT role FROM users WHERE tenant_id = $1 ORDER BY role', [
      tenantId,
    ]);
    expect(rows).toEqual([{ role: 'admin' }, { role: 'dispatcher' }]);
    await admin.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
  });
});
