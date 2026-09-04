import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppConfigModule } from './common/config/config.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { EnvelopeModule } from './common/envelope/envelope.module.js';
import { ErrorsModule } from './common/errors/errors.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { TenantModule } from './common/tenant/tenant.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { AppController } from './app.controller.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    // EnvelopeModule first: EnvelopeInterceptor wraps { data, meta,
    // request_id } around whatever IdempotencyInterceptor emits, so an
    // idempotency replay gets a fresh envelope (its own request_id) around
    // the cached body, not a stale nested one - see idempotency.interceptor.ts.
    EnvelopeModule,
    IdempotencyModule,
    ErrorsModule,
    TenantModule,
    IdentityModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  // Registered here (not app.use() in main.ts) so it's part of the module
  // graph: Test.createTestingModule({ imports: [AppModule] }) + app.init()
  // applies it too, the same way APP_INTERCEPTOR/APP_FILTER/APP_PIPE
  // providers do for the envelope/errors modules.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}
