/**
 * TowOS_MVP.md §7.2 — the one enum every error code lives in (BE-SPEC §9).
 * Codes are declared here in full because §7.2 is the canonical source; the
 * ones tagged below as Phase 1/2 aren't thrown anywhere yet (there is no
 * Call/Job/Dispatch model in Phase 0 - CLAUDE.md) but the literal string is
 * fixed now so nothing renames it later.
 */
export enum ErrorCode {
  // 400
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_TRANSITION = 'INVALID_TRANSITION', // Phase 1: job/dispatch state machine

  // 401
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // 403
  FORBIDDEN = 'FORBIDDEN',
  NOT_YOUR_DISPATCH = 'NOT_YOUR_DISPATCH', // Phase 1: dispatch ownership

  // 404
  NOT_FOUND = 'NOT_FOUND',

  // 409
  CONFLICT = 'CONFLICT',
  ALREADY_ASSIGNED = 'ALREADY_ASSIGNED', // Phase 1: dispatch assignment
  DUPLICATE_IDEMPOTENCY_KEY = 'DUPLICATE_IDEMPOTENCY_KEY', // idempotency guard, later slice
  STALE_VERSION = 'STALE_VERSION', // Phase 1: optimistic concurrency

  // 422
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',

  // 429
  RATE_LIMITED = 'RATE_LIMITED',

  // 500
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // 502
  UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE', // Phase 2: Swoop, Maps, object storage
}
