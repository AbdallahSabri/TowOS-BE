import type { Request } from 'express';

/**
 * pino-http (wired in common/logging) stamps `req.id` via genReqId before any
 * interceptor or filter runs. This is the one place that reads it back, so the
 * envelope and the error shape always agree on the same request_id.
 */
export function getRequestId(request: Request): string {
  const id = (request as unknown as { id?: unknown }).id;
  return typeof id === 'string' ? id : 'unknown';
}
