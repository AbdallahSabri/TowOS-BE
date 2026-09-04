import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UserRole } from './roles/user-role.enum.js';

export interface UserRecord {
  id: string;
  tenant_id: string;
  email: string;
  phone: string | null;
  full_name: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

export type PublicUser = Omit<UserRecord, 'password_hash'>;

/**
 * No TypeORM @Entity/schema management (BE-SPEC §8: hand-written SQL is the
 * only source of truth for the schema) - just parameterized raw SQL,
 * always run through the EntityManager TenantService.run() hands in, never
 * a bare dataSource.query().
 */
@Injectable()
export class UsersRepository {
  async findByEmailInCurrentTenant(
    manager: EntityManager,
    email: string,
  ): Promise<UserRecord | undefined> {
    const rows: UserRecord[] = await manager.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email],
    );
    return rows[0];
  }

  async findById(manager: EntityManager, id: string): Promise<UserRecord | undefined> {
    const rows: UserRecord[] = await manager.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0];
  }

  /**
   * Tenant ids that have an active user with this email - looked up outside
   * any tenant context (dataSource.query directly, deliberately not through
   * TenantService.run()) via the SECURITY DEFINER function in migration
   * 002, because there is no tenant context yet at login: that's exactly
   * what this discovers. See that migration's comment for why this is safe.
   */
  async findTenantIdsForEmail(dataSource: DataSource, email: string): Promise<string[]> {
    const rows: { find_tenant_ids_for_email: string }[] = await dataSource.query(
      'SELECT find_tenant_ids_for_email($1)',
      [email],
    );
    return rows.map((r) => r.find_tenant_ids_for_email);
  }

  async updateLastLoginAt(manager: EntityManager, id: string): Promise<void> {
    await manager.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
  }

  async updatePasswordHash(manager: EntityManager, id: string, passwordHash: string): Promise<void> {
    await manager.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  }

  toPublic(user: UserRecord): PublicUser {
    const { password_hash: _passwordHash, ...rest } = user;
    return rest;
  }
}
