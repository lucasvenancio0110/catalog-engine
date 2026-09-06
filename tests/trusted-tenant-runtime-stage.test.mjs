import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL,
  runTrustedTenantRuntimeStaging
} from '../scripts/cloudflare-trusted-tenant-runtime-stage.mjs';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-trusted-fresh-tenant-provision.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-trusted-tenant-runtime-stage.mjs', 'utf8');
const runner = fs.readFileSync('worker/tenant-runtime-runner.js', 'utf8');

describe('trusted tenant runtime staging boundary', () => {
  it('selects only verified, due, isolated provisioning tenants with a store profile', () => {
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("j.status IN ('pending','failed')");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain('j.attempt_count < ?2');
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain('j.next_attempt_at <= CURRENT_TIMESTAMP');
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain('JOIN tenant_store_profiles s');
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("i.status='provisioning'");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("p.database_status='active'");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("p.worker_status='active'");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("v.status='success'");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain("r.current_step='domain'");
    expect(TRUSTED_RUNTIME_STAGE_DISCOVERY_SQL).toContain('ORDER BY j.created_at ASC');
  });

  it('fails closed when trusted Cloudflare credentials are missing', async () => {
    await expect(
      runTrustedTenantRuntimeStaging({
        CLOUDFLARE_ACCOUNT_ID: '',
        CLOUDFLARE_API_TOKEN: '',
        CATALOG_CONTROL_DATABASE_ID: ''
      })
    ).rejects.toThrow('trusted_runtime_account_invalid');
  });

  it('is bounded, produces no private tenant identifiers and keeps recurring sync off', async () => {
    const evidence = await runTrustedTenantRuntimeStaging(
      {
        CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CLOUDFLARE_API_TOKEN: 'trusted-token-that-is-long-enough-for-tests',
        CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production',
        CATALOG_CONTROL_DATABASE_ID: '01234567-89ab-cdef-0123-456789abcdef',
        TRUSTED_RUNTIME_STAGE_LIMIT: '1'
      },
      {
        controlBatch: async () => [{ results: [] }]
      }
    );
    expect(evidence).toEqual({
      trustedTenantRuntimeStagingCompleted: true,
      trustedCiOwnsRuntimeUpload: true,
      recurringSyncAutomationEnabled: false,
      selected: 0,
      staged: 0,
      skipped: 0,
      failed: 0,
      productCounts: [],
      safeErrorCodes: []
    });
    expect(JSON.stringify(evidence)).not.toMatch(/tenantId|workerScriptName|databaseId|jobId/);
    expect(workflow).toContain("TRUSTED_RUNTIME_STAGE_LIMIT: '1'");
    expect(workflow).toContain('cloudflare-trusted-tenant-runtime-stage.mjs');
    expect(workflow).toContain("cron: '2-57/5 * * * *'");
    expect(workflow).toContain("test \"$VALUE\" = '0'");
  });

  it('moves Cloudflare administrative mutation out of the production Worker', () => {
    expect(script).toContain('uploadTenantCatalogWorker');
    expect(script).toContain('queryD1Batch');
    expect(script).toContain("runtime_status='staged'");
    expect(script).toContain("status='staged'");
    expect(runner).not.toContain('uploadTenantCatalogWorker');
    expect(runner).not.toContain('queryD1Batch');
    expect(runner).toContain('smokeTenantRuntime');
    expect(runner).toContain("j.status='staged'");
  });
});