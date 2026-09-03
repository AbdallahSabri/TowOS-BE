import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code.enum.js';

/**
 * Throw this instead of a bare NestJS HttpException whenever the response
 * needs a specific ErrorCode (TowOS_MVP.md §7.2) rather than the generic
 * per-status default the exception filter falls back to.
 */
export class AppError extends HttpException {
  public readonly code: ErrorCode;
  public readonly details: unknown;

  constructor(code: ErrorCode, message: string, status: HttpStatus, details: unknown = null) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}
