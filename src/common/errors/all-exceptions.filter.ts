import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { getRequestId } from '../envelope/request-id.js';
import { AppError } from './app-error.js';
import { ErrorCode } from './error-code.enum.js';

const DEFAULT_CODE_FOR_STATUS: ReadonlyMap<number, ErrorCode> = new Map([
  [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED],
  [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED],
  [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
  [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  [HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.BUSINESS_RULE_VIOLATION],
  [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
  [HttpStatus.BAD_GATEWAY, ErrorCode.UPSTREAM_UNAVAILABLE],
  [HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.UPSTREAM_UNAVAILABLE],
]);

interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: unknown;
    request_id: string;
  };
}

/**
 * BE-SPEC §9 / TowOS_MVP.md §7.2: one filter, one shape, one enum.
 * "A thrown error with no code maps to INTERNAL_ERROR and logs at error level."
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    // Equivalent to @InjectPinoLogger(context), without the ordering hazard
    // of that decorator's registration running before nestjs-pino builds its
    // provider list (which depends on which common/ module got imported first).
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = getRequestId(request);

    const { status, code, message, details } = this.resolve(exception);

    const isServerError = status >= 500; // HttpStatus.INTERNAL_SERVER_ERROR
    if (isServerError) {
      this.logger.error({ err: exception, code, status, requestId }, 'Unhandled exception');
    } else {
      this.logger.warn({ code, status, requestId }, message);
    }

    const body: ErrorBody = {
      error: { code, message, details, request_id: requestId },
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = DEFAULT_CODE_FOR_STATUS.get(status) ?? ErrorCode.INTERNAL_ERROR;
      return { status, code, message: exception.message, details: null };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      details: null,
    };
  }
}
