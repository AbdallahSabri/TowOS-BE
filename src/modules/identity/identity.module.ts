import { Module } from '@nestjs/common';
import { TenantModule } from '../../common/tenant/tenant.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import { UsersRepository } from './users.repository.js';
import { SessionsRepository } from './sessions.repository.js';
import { PasswordService } from './password.service.js';
import { BreachCheckService } from './breach-check.service.js';

/**
 * TowOS_MVP.md §6.2: identity owns users, sessions, roles, permissions -
 * and may not know about jobs. SessionGuard is exported so future modules
 * can protect their own routes with it without reaching into identity's
 * internals (BE-SPEC §6).
 */
@Module({
  imports: [TenantModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    UsersRepository,
    SessionsRepository,
    PasswordService,
    BreachCheckService,
  ],
  exports: [SessionGuard],
})
export class IdentityModule {}
