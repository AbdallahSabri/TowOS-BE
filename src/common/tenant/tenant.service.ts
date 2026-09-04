import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { assertValidTenantId } from './tenant-id.js';
import { tenantContextStorage } from './tenant-context.storage.js';

/**
 * CLAUDE.md invariant #2 / BE-SPEC §7.4: the only place that may call
 * SET LOCAL app.tenant_id. Every query that touches a business table goes
 * through TenantService.run() - never a bare `dataSource.query(...)` or a
 * manually opened transaction elsewhere in the codebase.
 */
@Injectable()
export class TenantService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    assertValidTenantId(tenantId);

    return this.dataSource.transaction((manager) =>
      tenantContextStorage.run({ tenantId }, async () => {
        // Interpolated, not parameterized: SET does not accept bind
        // parameters (see tenant-id.ts). tenantId is guaranteed UUID-shaped
        // by assertValidTenantId above, so this is not an injection surface.
        await manager.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
        return work(manager);
      }),
    );
  }
}
