import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module.js';
import { LoggingModule } from './common/logging/logging.module.js';

@Module({
  imports: [AppConfigModule, LoggingModule],
})
export class WorkerModule {}
