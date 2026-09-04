import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

/**
 * BE-SPEC §7.6: every request logs its tenant context. Set only by
 * tenant.service.ts's run(), for the duration of the wrapped work, so any
 * code further down the call stack (notably logging) can read it back
 * without having the tenant id threaded through every function signature.
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export function getCurrentTenantId(): string | undefined {
  return tenantContextStorage.getStore()?.tenantId;
}
