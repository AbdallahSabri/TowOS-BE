import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getRequestId } from './request-id.js';

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  request_id: string;
}

/**
 * BE-SPEC §9: every 2xx returns { data, meta, request_id }, built once here.
 * Controllers return their payload directly and never build this by hand.
 */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = getRequestId(request);

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {},
        request_id: requestId,
      })),
    );
  }
}
