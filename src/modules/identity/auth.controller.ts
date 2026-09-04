import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { SessionGuard, AuthenticatedRequest } from './session.guard.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import type { PublicUser } from './users.repository.js';

/**
 * BE-SPEC §10: the four endpoints Phase 0 ships. No signup/create-user
 * route here - BE-SPEC §10 lists exactly these four, and Phase 0 has no
 * public user-registration surface.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    const userAgent = request.headers['user-agent'] ?? null;
    const { cookieValue, maxAgeMs, user } = await this.authService.login(
      dto.email,
      dto.password,
      userAgent,
    );
    response.cookie(SESSION_COOKIE_NAME, cookieValue, sessionCookieOptions(maxAgeMs));
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.authService.logout(request.auth.tenantId, request.auth.sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest): { user: PublicUser } {
    return { user: request.auth.user };
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ changed: true }> {
    await this.authService.changePassword(
      request.auth.tenantId,
      request.auth.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { changed: true };
  }
}
