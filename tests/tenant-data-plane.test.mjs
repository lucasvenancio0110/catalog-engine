import { describe, expect, it } from 'vitest';
import { buildTenantDataPlanePlan, publicTenantDataPlaneState } from '../worker/tenant-data-plane.js';
import { cloudflarePlatformConfigured, runDueDataPlaneJobs } from '../worker/data-plane-provider-runner.js';

const tenantId = 't_0123456789abcdefabcd';

describe('tenant data-plane provisioning model', () => {
  it('derives stable per-tenant Worker and D1 names inside one shared dispatch namespace', async () => {
    const first = await buildTenantDataPlanePlan({
      tenantId,
      dispatchNamespace: 'catalog-engine-production'
    });
    const retry = await buildTenantDataPlanePlan({
      tenantId,
      dispatchNamespace: 'catalog-engine-production'
    });

    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      tenantId,
      provider: 'cloudflare_wfp',
      dispatchNamespace: 'catalog-engine-production',
      workerScriptName: 'ce-0123456789abcdefabcd',
      d1DatabaseName: 'ce-0123456789abcdefabcd'
    });
    expect(first.job.jobId).toMatch(/^dpjob_[a-f0-9]{20}$/);
  });

  it('does not expose provider resource identifiers in public data-plane status', () => {
    const state = publicTenantDataPlaneState({
      tenant_id: tenantId,
      provider: 'cloudflare_wfp',
      dispatch_namespace: 'catalog-engine-production',
      worker_script_name: 'ce-private-worker',
      d1_database_name: 'ce-private-db',
      d1_database_id: 'private-database-id',
      worker_status: 'active',
      database_status: 'active',
      last_checked_at: '2026-08-18T15:00:00Z',
      last_error_code: null
    });

    expect(state).toEqual({
      provider: 'cloudflare_wfp',
      status: 'provisioned',
      workerStatus: 'active',
      databaseStatus: 'active',
      lastCheckedAt: '2026-08-18T15:00:00Z',
      lastErrorCode: null
    });
    expect(JSON.stringify(state)).not.toMatch(/private-worker|private-db|database-id|dispatchNamespace/i);
  });

  it('keeps scheduled provisioning completely inert until dedicated platform credentials exist', async () => {
    let queried = false;
    const env = {
      CATALOG_DB: {
        prepare() {
          queried = true;
          throw new Error('D1 should remain untouched');
        }
      }
    };

    expect(cloudflarePlatformConfigured(env)).toBe(false);
    expect(await runDueDataPlaneJobs(env)).toEqual({
      enabled: false,
      reason: 'cloudflare_platform_unconfigured',
      processed: 0
    });
    expect(queried).toBe(false);
  });
});
