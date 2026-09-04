import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { TenantService } from '../src/common/tenant/tenant.service.js';

const { Client } = pg;

/**
 * BE-SPEC §14 Definition of Done:
 * - two tenants seeded, every query returns only the calling tenant's rows
 * - a query with no tenant context returns zero rows, never another tenant's
 *
 * Seeding goes through an admin connection (DATABASE_MIGRATION_URL, the
 * bypass-capable role - BE-SPEC §7) because inserting tenant A's own row
 * cannot itself be scoped to tenant A via TenantService.run() before that
 * row exists. Every read/write *under test* goes through TenantService.run(),
 * the same path real request handlers use - never a bare query.
 */
describe('Tenant isolation (integration)', () => {
  let app: INestApplication;
  let tenantService: TenantService;
  let admin: pg.Client;

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantService = app.get(TenantService);

    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2), ($3, $4)', [
      tenantA,
      'Integration Tenant A',
      tenantB,
      'Integration Tenant B',
    ]);
    await admin.query(
      'INSERT INTO locations (tenant_id, name, timezone, address) VALUES ($1, $2, $3, $4)',
      [tenantA, 'A Yard', 'America/Chicago', JSON.stringify({ city: 'Dallas' })],
    );
    await admin.query(
      'INSERT INTO locations (tenant_id, name, timezone, address) VALUES ($1, $2, $3, $4)',
      [tenantB, 'B Yard', 'America/Denver', JSON.stringify({ city: 'Denver' })],
    );
    await admin.query(
      'INSERT INTO users (tenant_id, email, full_name, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [tenantA, 'a-user@example.test', 'A User', 'not-a-real-hash', 'dispatcher'],
    );
    await admin.query(
      'INSERT INTO users (tenant_id, email, full_name, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [tenantB, 'b-user@example.test', 'B User', 'not-a-real-hash', 'dispatcher'],
    );
    await admin.query(
      'INSERT INTO audit_log (tenant_id, entity_type, entity_id, action) VALUES ($1, $2, $3, $4)',
      [tenantA, 'location', tenantA, 'seeded'],
    );
    await admin.query(
      'INSERT INTO audit_log (tenant_id, entity_type, entity_id, action) VALUES ($1, $2, $3, $4)',
      [tenantB, 'location', tenantB, 'seeded'],
    );
  });

  afterAll(async () => {
    // Business rows are never deleted (Technical_Reference §1) - clean up is
    // test-only housekeeping via the admin connection, not app behavior.
    await admin.query('DELETE FROM audit_log WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM sessions WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM locations WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await admin.end();
    await app.close();
  });

  it.each([
    ['locations', 'name', 'A Yard', 'B Yard'],
    ['users', 'email', 'a-user@example.test', 'b-user@example.test'],
  ])('scopes %s to only the calling tenant', async (table, column, valueA, valueB) => {
    const rowsAsA = await tenantService.run(tenantA, (manager) =>
      manager.query(`SELECT ${column} FROM ${table}`),
    );
    const rowsAsB = await tenantService.run(tenantB, (manager) =>
      manager.query(`SELECT ${column} FROM ${table}`),
    );

    expect(rowsAsA).toEqual([{ [column]: valueA }]);
    expect(rowsAsB).toEqual([{ [column]: valueB }]);
  });

  it('scopes audit_log to only the calling tenant', async () => {
    const asA = await tenantService.run(tenantA, (manager) =>
      manager.query('SELECT tenant_id FROM audit_log'),
    );
    const asB = await tenantService.run(tenantB, (manager) =>
      manager.query('SELECT tenant_id FROM audit_log'),
    );

    expect(asA).toEqual([{ tenant_id: tenantA }]);
    expect(asB).toEqual([{ tenant_id: tenantB }]);
  });

  it("returns zero rows, never another tenant's, when there is no tenant context", async () => {
    const dataSource = app.get(DataSource);
    const rows: unknown[] = await dataSource.query('SELECT name FROM locations');
    expect(rows).toEqual([]);
  });

  it('rejects a cross-tenant write', async () => {
    await expect(
      tenantService.run(tenantA, (manager) =>
        manager.query(
          'INSERT INTO locations (tenant_id, name, timezone, address) VALUES ($1, $2, $3, $4)',
          [tenantB, 'Sneaky Yard', 'UTC', '{}'],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects a non-UUID tenant id rather than interpolating it into SQL', async () => {
    await expect(
      tenantService.run("'; DROP TABLE tenants; --", (manager) => manager.query('SELECT 1')),
    ).rejects.toThrow(/invalid tenant id/i);
  });
});
