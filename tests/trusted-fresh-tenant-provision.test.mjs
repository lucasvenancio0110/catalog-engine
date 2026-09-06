import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TRUSTED_FRESH_DISCOVERY_SQL,
  runTrustedFreshTenantProvisioning
} from '../scripts/cloudflare-trusted-fresh-tenant-provision.mjs';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-trusted-fresh-tenant-provision.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-trusted-fresh-tenant-provision.mjs', 'utf8');

describe('trusted fresh tenant provisioning boundary', () => {
  it('selects only unfinished fresh provisioning before import', () => {
    expect(TRUSTED_FRESH_DISCOVERY_SQL).toContain("r.current_step IN ('data_plane','migrations')");
    expect(TRUSTED_FRESH_DISCOVERY_SQL).toContain("i.status='provisioning'");
    expect(TRUSTED_FRESH_DISCOVERY_SQL).toContain("s.status='active'");
    expect(TRUSTED_FRESH_DISCOVERY_SQL).not.toContain("i.status='ready'");
  });

  it('fails closed before provider mutation when trusted credentials are absent', async () => {
    await expect(
      runTrustedFreshTenantProvisioning({
        CLOUDFLARE_ACCOUNT_ID: '',
        CLOUDFLARE_API_TOKEN: '',
        CATALOG_CONTROL_DATABASE_ID: ''
      })
    ).rejects.toThrow('trusted_fresh_account_invalid');
  });

  it('keeps the trusted executor separate from recurring Intelligent Sync', () => {
    expect(workflow).toContain("TENANT_SYNC_AUTOMATION_ENABLED");
    expect(workflow).toContain("test \"$VALUE\" = '0'");
    expect(workflow).toContain("cron: '2-57/5 * * * *'");
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).not.toContain('TENANT_SYNC_AUTOMATION_ENABLED=1');
  });

  it('keeps physical provider identifiers out of the emitted outcome summary', () => {
    expect(script).toContain("outcomes.push({ outcome: 'ready_for_import' })");
    expect(script).not.toContain('outcomes.push({ tenantId');
    expect(script).not.toContain('console.log(candidate');
    expect(script).not.toContain('console.log(candidates');
    expect(script).toContain('trustedCiOwnedPhysicalProvisioning: true');
  });

  it('uses idempotent provider primitives and verifies the isolated schema before import', () => {
    expect(script).toContain('ensureD1Database');
    expect(script).toContain('uploadTenantBootstrapWorker');
    expect(script).toContain('tenantDataPlaneCurrentBatch');
    expect(script).toContain("Number(identity?.schema_version) !== TENANT_DATA_PLANE_SCHEMA_VERSION");
    expect(script).toContain("current_step='import'");
  });
});
