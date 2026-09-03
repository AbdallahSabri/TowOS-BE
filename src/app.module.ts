import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { EnvelopeModule } from './common/envelope/envelope.module.js';
import { ErrorsModule } from './common/errors/errors.module.js';
import { AppController } from './app.controller.js';

@Module({
  imports: [AppConfigModule, LoggingModule, EnvelopeModule, ErrorsModule],
  controllers: [AppController],
})
export class AppModule {}
