import { Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../../database/database.module.js';
import { TenantService } from './tenant.service.js';
import { assertNoBypassRls } from './assert-no-bypass-rls.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule implements OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await assertNoBypassRls(this.dataSource);
  }
}
