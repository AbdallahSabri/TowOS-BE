import { Global, Module } from '@nestjs/common';
import type { DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';

/**
 * Jest test double for nestjs-pino.
 *
 * nestjs-pino ships a CommonJS dist that internally `require()`s
 * @nestjs/common, an ESM-only package since Nest 12. Real Node 24 supports
 * that synchronous require(esm) - confirmed by running the real compiled
 * app (`node dist/main.js`) and exercising it over HTTP - but Jest's
 * `--experimental-vm-modules` sandbox does not, so importing nestjs-pino
 * inside Jest throws "Must use import to load ES Module". This stub keeps
 * Jest on the same ESM transform as the real build (required for the
 * genuinely ESM-only @nestjs/* packages) without pulling nestjs-pino's
 * broken require() path into the test runner. It is wired only via Jest's
 * moduleNameMapper - the production dependency and behavior are unchanged.
 */
export class PinoLogger {
  setContext(_context: string): void {}
  trace(..._args: unknown[]): void {}
  debug(..._args: unknown[]): void {}
  info(..._args: unknown[]): void {}
  warn(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
  fatal(..._args: unknown[]): void {}
}

export class Logger {
  log(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
  warn(..._args: unknown[]): void {}
  debug(..._args: unknown[]): void {}
  verbose(..._args: unknown[]): void {}
  fatal(..._args: unknown[]): void {}
}

@Global()
@Module({
  providers: [PinoLogger, Logger],
  exports: [PinoLogger, Logger],
})
export class LoggerModule implements NestModule {
  static forRoot(): DynamicModule {
    return { module: LoggerModule };
  }

  static forRootAsync(): DynamicModule {
    return { module: LoggerModule };
  }

  // Stands in for pino-http's genReqId: stamps req.id the same way
  // common/logging/pino-options.ts does, so the request-id contract
  // (middleware -> envelope/error filter) stays covered under Jest.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { id: string }).id = `req_${ulid()}`;
        next();
      })
      .forRoutes('*');
  }
}
