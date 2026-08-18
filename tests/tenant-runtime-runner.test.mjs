import { describe, expect, it, vi } from 'vitest';
import { runDueTenantRuntimes } from '../worker/tenant-runtime-runner.js';

describe('tenant runtime activation scheduler', () => {
  it('fails closed before control-plane reads when platform runtime is absent', async () => {
    const db = { prepare: vi.fn() };
    const fetchImpl = vi.fn();
    const result = await runDueTenantRuntimes({ CATALOG_DB: db }, { fetchImpl });
    expect(result).toEqual({
      enabled: false,
      reason: 'cloudflare_platform_unconfigured',
      processed: 0
    });
    expect(db.prepare).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before provider calls when the control-plane D1 is unbound', async () => {
    const fetchImpl = vi.fn();
    const result = await runDueTenantRuntimes(
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
