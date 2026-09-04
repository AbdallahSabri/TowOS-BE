import { createHash } from 'node:crypto';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'session';

/** BE-SPEC §10: HttpOnly, Secure, SameSite=Lax, 12h rolling. */
export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

/**
 * Cookie value is `${tenantId}.${rawToken}`: tenantId lets the session
 * guard call TenantService.run() before it has looked anything up (sessions
 * itself is RLS-scoped, so it can't be found without already knowing the
 * tenant) - see migration 002's find_tenant_ids_for_email comment for the
 * same problem at login. Never trusted on its own: the session row still
 * has to exist *under that exact tenant scope* via RLS, so a forged or
 * mismatched tenantId just fails to find the session, the same as any
 * other invalid cookie.
 */
export function encodeSessionCookie(tenantId: string, rawToken: string): string {
  return `${tenantId}.${rawToken}`;
}

export function decodeSessionCookie(value: string): { tenantId: string; rawToken: string } | null {
  const separatorIndex = value.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }
  return {
    tenantId: value.slice(0, separatorIndex),
    rawToken: value.slice(separatorIndex + 1),
  };
}

/**
 * Session tokens are high-entropy random values, not low-entropy secrets
 * like passwords - a fast hash is the right tool here (argon2id is
 * deliberately slow, which would make every authenticated request pay a
 * ~100ms tax for no security benefit on a value nothing can brute-force).
 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
