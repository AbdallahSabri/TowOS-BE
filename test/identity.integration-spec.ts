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
  error: { code: string; message: string };
}
interface UserBody {
  data: { user: Record<string, unknown> };
}

function sessionCookie(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = list.find((c) => c.startsWith('session='));
  if (!cookie) {
    throw new Error('No session cookie in response');
  }
  return cookie.split(';')[0];
}

/**
 * BE-SPEC §14: identity checkboxes.
 * - a user logs in and receives an HttpOnly session cookie; invalid
 *   password returns 401 with no user enumeration
 * - a session expires at its TTL and returns SESSION_EXPIRED
 *
 * Every POST here needs a fresh Idempotency-Key (common/idempotency/,
 * BE-SPEC §9): a missing one is now a 400 on any state-changing POST,
 * proven separately in idempotency.integration-spec.ts - reusing a literal
 * key across different calls in this file would risk one test's response
 * getting replayed into another's, so every call gets its own randomUUID().
 */
describe('Identity (integration)', () => {
  let app: INestApplication;
  let admin: pg.Client;
  let server: Server;

  const tenantId = randomUUID();
  const email = 'identity-test@example.test';
  // Random, not a memorable phrase: a real (unmocked) breach-list check
  // runs on every password set (BE-SPEC §10), and a phrase like "correct
  // horse battery staple" is genuinely in HaveIBeenPwned's corpus - it
  // would get rejected, which is the check working, not a test bug.
  const password = `test-fixture-${randomBytes(12).toString('base64url')}`;

  function post(path: string): request.Test {
    return request(server).post(path).set('Idempotency-Key', randomUUID());
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      'Identity Test Tenant',
    ]);
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'dispatcher')`,
      [tenantId, email, 'Identity Test User', hash],
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

  it('rejects an unknown email with generic 401 (no enumeration)', async () => {
    const res = await post('/auth/login')
      .send({ email: 'nobody-at-all@example.test', password: 'whatever-12345' })
      .expect(401);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('rejects a known email with the wrong password - same generic 401', async () => {
    const res = await post('/auth/login')
      .send({ email, password: 'the-wrong-password' })
      .expect(401);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('logs in and receives an HttpOnly, Secure, SameSite=Lax session cookie', async () => {
    const res = await post('/auth/login').send({ email, password }).expect(200);

    const raw = res.headers['set-cookie'] as unknown as string[];
    const cookie = raw.find((c) => c.startsWith('session='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const body = res.body as UserBody;
    expect(body.data.user.email).toBe(email);
    expect(body.data.user).not.toHaveProperty('password_hash');
  });

  it('GET /auth/me returns the current user for a valid session', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);

    const meRes = await request(server).get('/auth/me').set('Cookie', cookie).expect(200);
    const body = meRes.body as UserBody;
    expect(body.data.user.email).toBe(email);
  });

  it('GET /auth/me with no cookie is unauthenticated', async () => {
    const res = await request(server).get('/auth/me').expect(401);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST /auth/logout invalidates the session', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);

    await post('/auth/logout').set('Cookie', cookie).expect(200);

    const res = await request(server).get('/auth/me').set('Cookie', cookie).expect(401);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST /auth/password changes the password; old stops working, new works', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);
    const newPassword = `test-fixture-${randomBytes(12).toString('base64url')}`;

    await post('/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword })
      .expect(200);

    await post('/auth/login').send({ email, password }).expect(401);

    const relogin = await post('/auth/login').send({ email, password: newPassword }).expect(200);
    expect((relogin.body as UserBody).data.user.email).toBe(email);

    // restore the fixture password for the remaining tests in this file
    const restoreCookie = sessionCookie(relogin);
    await post('/auth/password')
      .set('Cookie', restoreCookie)
      .send({ currentPassword: newPassword, newPassword: password })
      .expect(200);
  });

  it('rejects a new password shorter than 10 characters', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);

    const res = await post('/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: 'short' })
      .expect(400);
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a new password that appears in a known breach list', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);

    // A real (unmocked) call to HaveIBeenPwned's k-anonymity API - this is
    // one of the most famous example passwords in existence and is
    // genuinely in that corpus, which is exactly why identity.integration-
    // spec.ts's other fixture passwords are random rather than memorable.
    const res = await post('/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: 'correct horse battery staple' })
      .expect(400);
    const body = res.body as { error: { code: string; details: { issue: string }[] } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details[0].issue).toBe('breached');
  });

  it('a session past its TTL returns SESSION_EXPIRED, not silent failure', async () => {
    const loginRes = await post('/auth/login').send({ email, password }).expect(200);
    const cookie = sessionCookie(loginRes);

    await admin.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE tenant_id = $1`,
      [tenantId],
    );

    const res = await request(server).get('/auth/me').set('Cookie', cookie).expect(401);
    expect((res.body as ErrorBody).error.code).toBe('SESSION_EXPIRED');
  });
});
