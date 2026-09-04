import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { TenantModule } from './common/tenant/tenant.module.js';

@Module({
  imports: [AppConfigModule, LoggingModule, TenantModule],
})
export class WorkerModule {}
