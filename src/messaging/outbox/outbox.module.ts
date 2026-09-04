import { Module } from '@nestjs/common';
import { TenantModule } from '../../common/tenant/tenant.module.js';
import { OutboxRelayService } from './outbox-relay.service.js';

@Module({
  imports: [TenantModule],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class OutboxModule {}
