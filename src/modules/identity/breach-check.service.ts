import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * BE-SPEC §10: passwords are "checked against a breach list on set". Uses
 * Have I Been Pwned's k-anonymity range API - only a 5-character SHA-1
 * prefix ever leaves this process, never the password or its full hash.
 *
 * Fails open (logs a warning, treats the password as not breached) if the
 * API is unreachable: argon2id is the primary defense, this is one
 * additional layer on top of it, and this service's own availability
 * shouldn't gate every password change on a third party's uptime.
 */
@Injectable()
export class BreachCheckService {
  private readonly logger = new Logger(BreachCheckService.name);

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      if (!response.ok) {
        this.logger.warn(`Breach check API returned ${response.status}; failing open`);
        return false;
      }
      const body = await response.text();
      return body.split('\n').some((line) => line.trim().split(':')[0] === suffix);
    } catch (err) {
      this.logger.warn(
        `Breach check API unreachable; failing open: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
