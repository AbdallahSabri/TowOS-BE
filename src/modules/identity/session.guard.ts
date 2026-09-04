import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { TenantService } from '../../common/tenant/tenant.service.js';
import type { EnvironmentVariables } from '../../common/config/environment-variables.js';
import { UsersRepository, PublicUser } from './users.repository.js';
import { SessionsRepository } from './sessions.repository.js';
import {
  SESSION_COOKIE_NAME,
  decodeSessionCookie,
  encodeSessionCookie,
  hashSessionToken,
  sessionCookieOptions,
} from './session-cookie.js';

export interface AuthContext {
  tenantId: string;
  sessionId: string;
  user: PublicUser;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

const UNAUTHENTICATED = () =>
  new AppError(ErrorCode.UNAUTHENTICATED, 'Not authenticated', HttpStatus.UNAUTHORIZED);

type Resolution =
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'ok'; tenantId: string; sessionId: string; user: PublicUser };

/**
 * BE-SPEC §10: HttpOnly session cookie -> user + role, 12h rolling. The
 * only place a session cookie is turned into a tenant + user - every
 * protected route in the app goes through this, never its own cookie
 * parsing.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly tenantService: TenantService,
    private readonly sessionsRepo: SessionsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const cookieValue = cookies?.[SESSION_COOKIE_NAME];
    if (!cookieValue) {
      throw UNAUTHENTICATED();
    }

    const decoded = decodeSessionCookie(cookieValue);
    if (!decoded) {
      throw UNAUTHENTICATED();
    }

    const ttlMs = this.configService.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000;

    let resolution: Resolution;
    try {
      resolution = await this.tenantService.run(decoded.tenantId, async (manager) => {
        const session = await this.sessionsRepo.findByTokenHash(
          manager,
          hashSessionToken(decoded.rawToken),
        );
        if (!session) {
          return { kind: 'not-found' } as const;
        }
        if (session.expires_at.getTime() <= Date.now()) {
          return { kind: 'expired' } as const;
        }

        const user = await this.usersRepo.findById(manager, session.user_id);
        if (!user || !user.is_active) {
          return { kind: 'not-found' } as const;
        }

        // Rolling: extend on every successful use.
        const newExpiresAt = new Date(Date.now() + ttlMs);
        await this.sessionsRepo.extendExpiry(manager, session.id, newExpiresAt);

        return {
          kind: 'ok',
          tenantId: decoded.tenantId,
          sessionId: session.id,
          user: this.usersRepo.toPublic(user),
        } as const;
      });
    } catch {
      // Malformed tenant id in the cookie, or any other lookup failure -
      // same generic response as any other invalid session (no enumeration).
      throw UNAUTHENTICATED();
    }

    if (resolution.kind === 'not-found') {
      throw UNAUTHENTICATED();
    }
    if (resolution.kind === 'expired') {
      throw new AppError(ErrorCode.SESSION_EXPIRED, 'Session expired', HttpStatus.UNAUTHORIZED);
    }

    response.cookie(
      SESSION_COOKIE_NAME,
      encodeSessionCookie(resolution.tenantId, decoded.rawToken),
      sessionCookieOptions(ttlMs),
    );

    (request as AuthenticatedRequest).auth = {
      tenantId: resolution.tenantId,
      sessionId: resolution.sessionId,
      user: resolution.user,
    };

    return true;
  }
}
