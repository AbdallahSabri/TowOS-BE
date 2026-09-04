import { HttpStatus, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { BreachCheckService } from './breach-check.service.js';

const MIN_LENGTH = 10;

/**
 * BE-SPEC §10: argon2id, minimum 10 characters, checked against a breach
 * list on set. The single place any password gets hashed, verified, or
 * validated - a future seed script and /auth/password both go through this,
 * not their own copies of the rule.
 */
@Injectable()
export class PasswordService {
  constructor(private readonly breachCheck: BreachCheckService) {}

  async assertValid(password: string): Promise<void> {
    if (password.length < MIN_LENGTH) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Password must be at least ${MIN_LENGTH} characters`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'password', issue: 'minLength' }],
      );
    }
    if (await this.breachCheck.isBreached(password)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'This password has appeared in a known data breach. Choose a different one.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'password', issue: 'breached' }],
      );
    }
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
