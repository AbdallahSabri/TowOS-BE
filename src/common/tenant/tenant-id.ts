const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `SET LOCAL app.tenant_id = $1` is not valid SQL - PostgreSQL's SET does not
 * accept bind parameters (confirmed against a real instance; it raises a
 * syntax error), so tenant.service.ts must interpolate the value into the
 * statement text. This is the guard that makes that interpolation safe: a
 * strict UUID shape is the only thing ever allowed through, so there is no
 * character available to break out of the string literal.
 */
export function assertValidTenantId(tenantId: string): void {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`Invalid tenant id: expected a UUID, got ${JSON.stringify(tenantId)}`);
  }
}
