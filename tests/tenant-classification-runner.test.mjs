import { describe, expect, it, vi } from 'vitest';
import { runDueTenantClassifications } from '../worker/tenant-classification-runner.js';

function emptySchedulerDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 0 } }))
      })),
      run: vi.fn(async () => ({ meta: { changes: 0 } }))
    }))
  };
}

describe('tenant classification scheduler', () => {
  it('fails closed before control-plane reads when platform runtime is absent', async () => {
    const db = { prepare: vi.fn() };
    const fetchImpl = vi.fn();
    const result = await runDueTenantClassifications({ CATALOG_DB: db }, { fetchImpl });
    expect(result).toEqual({
      enabled: false,
      reason: 'cloudflare_platform_unconfigured',
      processed: 0
    });
    expect(db.prepare).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs scheduler discovery with tenant dispatch and no administrative Cloudflare token', async () => {
    const db = emptySchedulerDb();
    const tenantDispatch = { get: vi.fn() };
    const fetchImpl = vi.fn();
    const result = await runDueTenantClassifications(
      { CATALOG_DB: db, TENANT_DISPATCH: tenantDispatch },
      { fetchImpl }
    );

    expect(result).toMatchObject({
      enabled: true,
      discovered: 0,
      selected: 0,
      processed: 0,
      failed: 0
    });
    expect(db.prepare).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before provider work when the control-plane binding is absent', async () => {
    const fetchImpl = vi.fn();
    const result = await runDueTenantClassifications(
      {
        CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token-that-is-long-enough-for-tests',
        CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
      },
      { fetchImpl }
    );
    expect(result).toEqual({ enabled: false, reason: 'database_unbound', processed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
