import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, '.jest-log-scan-probe');
const mainPath = join(outDir, 'src', 'main.js');
const PORT = 4321;

async function waitForPort(port: number, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`App did not start listening on port ${port} in time`);
}

/**
 * BE-SPEC §14: "A log scan across a day of traffic finds zero customer
 * phone numbers, emails, or addresses, and zero credentials." Phase 0's
 * only endpoints handling anything sensitive are /auth/* (email,
 * password, session token) - no Job/Call/Customer model exists yet for
 * phone/address. Spawns the real compiled app (not a mock logger),
 * generates a representative batch of real traffic carrying real secrets,
 * captures actual stdout (where pino writes), and greps it.
 */
describe('Log scan for PII and credentials (integration)', () => {
  let admin: pg.Client;
  let child: ChildProcessWithoutNullStreams;
  let capturedLogs = '';

  const tenantId = randomUUID();
  const email = 'log-scan-test@example.test';
  const password = `test-fixture-${randomBytes(16).toString('base64url')}`;
  const wrongPassword = `wrong-fixture-${randomBytes(16).toString('base64url')}`;

  beforeAll(async () => {
    rmSync(outDir, { recursive: true, force: true });
    execFileSync(join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json', '--outDir', outDir], {
      cwd: repoRoot,
    });

    admin = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await admin.connect();
    await admin.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      'Log Scan Test Tenant',
    ]);
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO users (tenant_id, email, phone, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'dispatcher')`,
      [tenantId, email, '+15555550123', 'Log Scan Test User', hash],
    );

    child = spawn(process.execPath, [mainPath], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info' },
      stdio: 'pipe',
    });
    child.stdout.on('data', (chunk: Buffer) => {
      capturedLogs += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      capturedLogs += chunk.toString();
    });

    await waitForPort(PORT);

    // A representative batch of real traffic, including realistic
    // sensitive values in the body, query string, and headers.
    await fetch(`http://localhost:${PORT}/auth/login?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'User-Agent': 'log-scan-integration-test/1.0',
      },
      body: JSON.stringify({ email, password: wrongPassword }),
    });

    const loginRes = await fetch(`http://localhost:${PORT}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0];

    await fetch(`http://localhost:${PORT}/auth/me`, {
      headers: { Cookie: cookie, Authorization: 'Bearer fake-bearer-token-should-not-log' },
    });

    const newPassword = `test-fixture-${randomBytes(16).toString('base64url')}`;
    await fetch(`http://localhost:${PORT}/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });

    await fetch(`http://localhost:${PORT}/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ currentPassword: newPassword, newPassword: password }),
    });

    await fetch(`http://localhost:${PORT}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Idempotency-Key': randomUUID() },
    });

    // Give pino's async logger a moment to flush the last lines.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, 60_000);

  afterAll(async () => {
    child.kill('SIGKILL');
    await admin.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await admin.end();
    rmSync(outDir, { recursive: true, force: true });
  });

  it('captured a realistic amount of log traffic', () => {
    expect(capturedLogs.length).toBeGreaterThan(0);
    expect(capturedLogs).toMatch(/"msg":"request completed"/);
  });

  it('the log never contains the plaintext password', () => {
    expect(capturedLogs).not.toContain(password);
    expect(capturedLogs).not.toContain(wrongPassword);
  });

  it('the log never contains the customer email', () => {
    expect(capturedLogs).not.toContain(email);
  });

  it('the log never contains the customer phone number', () => {
    expect(capturedLogs).not.toContain('+15555550123');
    expect(capturedLogs).not.toContain('5555550123');
  });

  it('the log never contains the session token or Authorization header', () => {
    expect(capturedLogs).not.toMatch(/session=[0-9a-f-]+\.[0-9a-f]+/);
    expect(capturedLogs).not.toContain('fake-bearer-token-should-not-log');
    expect(capturedLogs).not.toMatch(/authorization/i);
  });

  it('the log never contains a query string (only the path)', () => {
    expect(capturedLogs).not.toContain('?email=');
  });

  it('the log allowlist held: every req entry has only id/method/url, every res entry only statusCode', () => {
    const lines = capturedLogs
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const requestLines = lines.filter((line) => 'req' in line);
    expect(requestLines.length).toBeGreaterThan(0);
    for (const line of requestLines) {
      expect(Object.keys(line.req as Record<string, unknown>).sort()).toEqual([
        'id',
        'method',
        'url',
      ]);
      if ('res' in line) {
        expect(Object.keys(line.res as Record<string, unknown>)).toEqual(['statusCode']);
      }
    }
  });
});
