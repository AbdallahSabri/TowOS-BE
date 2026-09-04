import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import argon2 from 'argon2';
import pg from 'pg';
import { AppModule } from '../src/app.module.js';

const { Client } = pg;

interface ErrorBody {
  error: { code: string; details?: { field: string; issue: string }[] };
}

function sessionCookie(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith('session='));
  if (!cookie) {
    throw new Error('No session cookie in response');
  }
  return cookie.split(';')[0];
}

/**
 * BE-SPEC §14 / §9 / CLAUDE.md invariant #6: a state-changing POST with no
 * Idempotency-Key returns 400 VALIDATION_FAILED; a repeated key returns
 * the original response and writes nothing new.
 */
describe('Idempotency (integration)', () => {
  let app: INestApplication;
  let admin: pg.Client;
  let server: Server;

  const tenantId = randomUUID();
  const email = 'idempotency-test@example.test';
  const password = `test-fixture-${randomBytes(12).toString('base64url')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      'Idempotency Test Tenant',
    ]);
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'dispatcher')`,
      [tenantId, email, 'Idempotency Test User', hash],
    );
  });

  afterAll(async () => {
    await admin.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await admin.end();
    await app.close();
  });

  it('rejects a state-changing POST with no Idempotency-Key header', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ email, password })
      .expect(400);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.[0]).toEqual({ field: 'Idempotency-Key', issue: 'required' });
  });

  it('does not require Idempotency-Key on GET', async () => {
    await request(server).get('/health').expect(200);
  });

  it('a repeated key on an authenticated POST replays the original response and re-runs nothing', async () => {
    const loginRes = await request(server)
      .post('/auth/login')
      .set('Idempotency-Key', randomUUID())
      .send({ email, password })
      .expect(200);
    const cookie = sessionCookie(loginRes);

    const key = randomUUID();
    const newPassword = `test-fixture-${randomBytes(12).toString('base64url')}`;

    const first = await request(server)
      .post('/auth/password')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ currentPassword: password, newPassword })
      .expect(200);

    // Same key, and deliberately a *different* body: if this actually
    // re-ran the handler, currentPassword here is now wrong (the real
    // password is newPassword after the first call), which would fail
    // with 400 VALIDATION_FAILED - getting the identical 200 back proves
    // the handler never executed a second time.
    const second = await request(server)
      .post('/auth/password')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ currentPassword: 'this-is-not-the-current-password', newPassword: 'irrelevant-too' })
      .expect(200);

    // request_id is legitimately fresh on every response, replay included
    // (it's assigned by EnvelopeInterceptor around the cached body, not
    // part of what's cached) - everything else must match exactly.
    expect(second.status).toBe(first.status);
    expect((second.body as { data: unknown }).data).toEqual(
      (first.body as { data: unknown }).data,
    );

    const { rows }: { rows: { n: number }[] } = await admin.query(
      `SELECT count(*)::int AS n FROM idempotency_keys
       WHERE tenant_id = $1 AND endpoint = 'POST /auth/password' AND idempotency_key = $2`,
      [tenantId, key],
    );
    expect(rows[0].n).toBe(1);

    // The only password change that actually took effect is the first
    // call's - proof, not inference, that "writes nothing new" held.
    await request(server)
      .post('/auth/login')
      .set('Idempotency-Key', randomUUID())
      .send({ email, password: newPassword })
      .expect(200);

    const restoreCookie = sessionCookie(
      await request(server)
        .post('/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({ email, password: newPassword })
        .expect(200),
    );
    await request(server)
      .post('/auth/password')
      .set('Cookie', restoreCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ currentPassword: newPassword, newPassword: password })
      .expect(200);
  });

  it('does not cache or replay a failed (non-2xx) response', async () => {
    const loginRes = await request(server)
      .post('/auth/login')
      .set('Idempotency-Key', randomUUID())
      .send({ email, password })
      .expect(200);
    const cookie = sessionCookie(loginRes);
    const key = randomUUID();

    await request(server)
      .post('/auth/password')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ currentPassword: 'wrong-current-password', newPassword: 'irrelevant-here-too' })
      .expect(400);

    // Same key, this time with the correct current password - since the
    // first attempt failed and was never cached, this must actually run
    // and succeed, not replay the earlier failure.
    const newPassword = `test-fixture-${randomBytes(12).toString('base64url')}`;
    await request(server)
      .post('/auth/password')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ currentPassword: password, newPassword })
      .expect(200);

    // restore
    await request(server)
      .post('/auth/password')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ currentPassword: newPassword, newPassword: password })
      .expect(200);
  });

  it('scopes idempotency keys per tenant - the same key on a different tenant runs independently', async () => {
    const otherTenantId = randomUUID();
    const otherEmail = 'idempotency-other-tenant@example.test';
    const otherPassword = `test-fixture-${randomBytes(12).toString('base64url')}`;
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      otherTenantId,
      'Idempotency Other Tenant',
    ]);
    const otherHash = await argon2.hash(otherPassword, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'dispatcher')`,
      [otherTenantId, otherEmail, 'Other Tenant User', otherHash],
    );

    const key = randomUUID();

    const cookieA = sessionCookie(
      await request(server)
        .post('/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({ email, password })
        .expect(200),
    );
    const cookieB = sessionCookie(
      await request(server)
        .post('/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({ email: otherEmail, password: otherPassword })
        .expect(200),
    );

    const resA = await request(server)
      .post('/auth/logout')
      .set('Cookie', cookieA)
      .set('Idempotency-Key', key)
      .expect(200);
    const resB = await request(server)
      .post('/auth/logout')
      .set('Cookie', cookieB)
      .set('Idempotency-Key', key)
      .expect(200);

    const bodyA = resA.body as { data: { loggedOut: true } };
    const bodyB = resB.body as { data: { loggedOut: true } };
    expect(bodyA.data.loggedOut).toBe(true);
    expect(bodyB.data.loggedOut).toBe(true);

    // If tenant scoping were broken, this would be one shared idempotency
    // row instead of two - and the second call would have replayed the
    // first's cached response rather than actually invalidating its own
    // session, which the /auth/me checks below rule out directly.
    await request(server).get('/auth/me').set('Cookie', cookieA).expect(401);
    await request(server).get('/auth/me').set('Cookie', cookieB).expect(401);

    const { rows }: { rows: { tenant_id: string }[] } = await admin.query(
      `SELECT tenant_id FROM idempotency_keys WHERE idempotency_key = $1 ORDER BY tenant_id`,
      [key],
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([tenantId, otherTenantId].sort());

    await admin.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [otherTenantId]);
    await admin.query('DELETE FROM sessions WHERE tenant_id = $1', [otherTenantId]);
    await admin.query('DELETE FROM users WHERE tenant_id = $1', [otherTenantId]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [otherTenantId]);
  });
});
