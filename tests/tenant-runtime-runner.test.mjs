import { readFile } from 'node:fs/promises';
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

  it('does not let an incomplete older tenant starve a ready runtime candidate', async () => {
    const source = await readFile(new URL('../worker/tenant-runtime-runner.js', import.meta.url), 'utf8');
    const discoveryStart = source.indexOf('async function discoverCandidates');
    const contextStart = source.indexOf('async function loadContext');
    const dueStart = source.indexOf('const due = await db');
    const outcomesStart = source.indexOf('const outcomes = []');
    const discovery = source.slice(discoveryStart, contextStart);
    const due = source.slice(dueStart, outcomesStart);

    expect(discovery).toContain('JOIN tenant_store_profiles s ON s.tenant_id=r.tenant_id');
    expect(due).toContain('FROM tenant_runtime_jobs j');
    expect(due).toContain('SELECT 1 FROM tenant_store_profiles s');
    expect(due).toContain('SELECT 1 FROM tenant_catalog_instances i');
    expect(due).toContain('SELECT 1 FROM tenant_data_plane_provider_state p');
    expect(due).toContain('SELECT 1 FROM tenant_verification_jobs v');
    expect(due).toContain('SELECT 1 FROM tenant_provisioning_runs r');
    expect(due).toContain("r.current_step='domain'");
    expect(due).toContain("i.status='provisioning'");
    expect(due).toContain("p.database_status='active'");
    expect(due).toContain("p.worker_status='active'");
    expect(due).toContain("v.status='success'");
    expect(due).toContain('ORDER BY j.created_at ASC');
    expect(due).toContain('LIMIT ?3');
  });

  it('never calls Cloudflare administrative APIs from the production Worker cron', async () => {
    const source = await readFile(new URL('../worker/tenant-runtime-runner.js', import.meta.url), 'utf8');
    expect(source).not.toContain('uploadTenantCatalogWorker');
    expect(source).not.toContain('queryD1Batch');
    expect(source).not.toContain('api.cloudflare.com');
    expect(source).toContain("j.status='staged'");
    expect(source).toContain("p.runtime_kind='catalog'");
    expect(source).toContain("p.runtime_status='staged'");
    expect(source).toContain("reason: 'awaiting_trusted_runtime_stage'");
    expect(source).toContain('smokeTenantRuntime');
  });
});