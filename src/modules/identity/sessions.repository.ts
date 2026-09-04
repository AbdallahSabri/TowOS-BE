import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface SessionRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
}

@Injectable()
export class SessionsRepository {
  async create(
    manager: EntityManager,
    params: {
      tenantId: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent: string | null;
    },
  ): Promise<SessionRecord> {
    const rows: SessionRecord[] = await manager.query(
      `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.tenantId, params.userId, params.tokenHash, params.expiresAt, params.userAgent],
    );
    return rows[0];
  }

  async findByTokenHash(
    manager: EntityManager,
    tokenHash: string,
  ): Promise<SessionRecord | undefined> {
    const rows: SessionRecord[] = await manager.query(
      'SELECT * FROM sessions WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0];
  }

  async extendExpiry(manager: EntityManager, id: string, expiresAt: Date): Promise<void> {
    await manager.query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [expiresAt, id]);
  }

  async deleteById(manager: EntityManager, id: string): Promise<void> {
    await manager.query('DELETE FROM sessions WHERE id = $1', [id]);
  }
}
