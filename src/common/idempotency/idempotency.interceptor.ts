import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { IdempotencyCacheService } from './idempotency-cache.service.js';

const IDEMPOTENCY_HEADER = 'idempotency-key';

// Duck-typed rather than imported from modules/identity/ (BE-SPEC §6:
// common/ doesn't depend on a module's internals) - any guard that
// resolves a tenant onto the request satisfies this.
interface MaybeAuthenticatedRequest extends Request {
  auth?: { tenantId: string };
}

/**
 * CLAUDE.md invariant #6 / BE-SPEC §9: every state-changing POST requires
 * Idempotency-Key; a repeated key returns the original response and writes
 * nothing new. Global (APP_INTERCEPTOR), so Phase 1's POST routes inherit
 * this rather than adding it (§9's own words for why it's wired now even
 * though only /auth/* exists).
 *
 * Runs *inside* EnvelopeInterceptor (registered after EnvelopeModule in
 * AppModule's imports - Nest nests global interceptors in registration
 * order): it caches/replays the controller's raw return value, before
 * envelope wraps it into { data, meta, request_id }, so a replay gets a
 * fresh request_id/meta like any other response rather than a stale nested
 * envelope.
 *
 * Only successful (2xx) responses are cached. A request that throws isn't
 * cached - a retry with the same key re-attempts the operation, which is a
 * deliberate scope decision for Phase 0: caching failures too (as Stripe's
 * idempotency keys do) is a reasonable enhancement, not something BE-SPEC's
 * "writes nothing new" checkbox requires, and Phase 0 has no real business
 * mutation to make that distinction matter yet.
 *
 * A pre-auth route (login: no `request.auth` yet, by definition - see
 * migration 002's tenant-discovery comment) still requires the header for
 * consistency, but isn't cached: there's no tenant to scope storage by.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly cache: IdempotencyCacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();

    if (request.method !== 'POST') {
      return next.handle();
    }

    const key = request.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || key.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Idempotency-Key header is required',
        HttpStatus.BAD_REQUEST,
        [{ field: 'Idempotency-Key', issue: 'required' }],
      );
    }

    const tenantId = request.auth?.tenantId;
    if (!tenantId) {
      return next.handle();
    }

    const endpoint = `POST ${request.path}`;
    const response = context.switchToHttp().getResponse<Response>();

    return from(this.cache.find(tenantId, endpoint, key)).pipe(
      switchMap((cached) => {
        if (cached) {
          response.status(cached.status);
          return of(cached.body);
        }
        // The store has to complete *before* this observable emits - Nest
        // sends the response as soon as it does, so a fire-and-forget store
        // here would race an immediate retry: the response could reach the
        // client before the cache write lands, and the retry would find
        // nothing and re-run the operation instead of replaying it.
        return next.handle().pipe(
          switchMap((body: unknown) => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              return of(body);
            }
            return from(this.cache.store(tenantId, endpoint, key, response.statusCode, body)).pipe(
              map(() => body),
            );
          }),
        );
      }),
    );
  }
}
