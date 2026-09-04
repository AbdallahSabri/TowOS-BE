import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { TenantService } from '../../common/tenant/tenant.service.js';
import type { EnvironmentVariables } from '../../common/config/environment-variables.js';
import { UsersRepository, PublicUser } from './users.repository.js';
import { SessionsRepository } from './sessions.repository.js';
import { PasswordService } from './password.service.js';
import { encodeSessionCookie, hashSessionToken } from './session-cookie.js';

// A real argon2id hash of an unrelated password, verified against on every
// login attempt where no candidate tenant exists at all - so "email exists
// nowhere" and "email exists, password wrong" both pay the same ~100ms
// argon2 cost instead of the former returning near-instantly (BE-SPEC §10:
// "no user enumeration").
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$NuadcAQ8myTT5mmy5+DL5A$mCl/W2G8I2kGRrs8Dmtky8pcnO0xpLog0X2zux2ceCw';

export interface LoginResult {
  cookieValue: string;
  maxAgeMs: number;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantService: TenantService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersRepo: UsersRepository,
    private readonly sessionsRepo: SessionsRepository,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async login(email: string, password: string, userAgent: string | null): Promise<LoginResult> {
    const ttlMs = this.configService.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000;

    // No tenant context exists yet - this is the one lookup in the codebase
    // that runs outside TenantService.run(), see migration 002.
    const tenantIds = await this.usersRepo.findTenantIdsForEmail(this.dataSource, email);

    for (const tenantId of tenantIds) {
      const outcome = await this.tenantService.run(tenantId, async (manager) => {
        const user = await this.usersRepo.findByEmailInCurrentTenant(manager, email);
        if (!user) {
          return null;
        }
        const validPassword = await this.passwordService.verify(user.password_hash, password);
        if (!validPassword) {
          return null;
        }

        const rawToken = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + ttlMs);
        await this.sessionsRepo.create(manager, {
          tenantId,
          userId: user.id,
          tokenHash: hashSessionToken(rawToken),
          expiresAt,
          userAgent,
        });
        await this.usersRepo.updateLastLoginAt(manager, user.id);

        const result: LoginResult = {
          cookieValue: encodeSessionCookie(tenantId, rawToken),
          maxAgeMs: ttlMs,
          user: this.usersRepo.toPublic(user),
        };
        return result;
      });

      if (outcome) {
        return outcome;
      }
    }

    if (tenantIds.length === 0) {
      await this.passwordService.verify(DUMMY_HASH, password).catch(() => false);
    }

    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  async logout(tenantId: string, sessionId: string): Promise<void> {
    await this.tenantService.run(tenantId, (manager) =>
      this.sessionsRepo.deleteById(manager, sessionId),
    );
  }

  async changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.tenantService.run(tenantId, async (manager) => {
      const user = await this.usersRepo.findById(manager, userId);
      if (!user) {
        throw new AppError(
          ErrorCode.UNAUTHENTICATED,
          'Not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const validCurrent = await this.passwordService.verify(user.password_hash, currentPassword);
      if (!validCurrent) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'Current password is incorrect',
          HttpStatus.BAD_REQUEST,
          [{ field: 'currentPassword', issue: 'incorrect' }],
        );
      }

      await this.passwordService.assertValid(newPassword);
      const newHash = await this.passwordService.hash(newPassword);
      await this.usersRepo.updatePasswordHash(manager, userId, newHash);
    });
  }
}
