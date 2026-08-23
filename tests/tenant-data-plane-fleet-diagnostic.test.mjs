import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyFleetDiagnostic,
  RETAINED_FLEET_FIXTURES,
  resolveRetainedFleetFixtures
} from '../scripts/cloudflare-tenant-data-plane-fleet-diagnostic.mjs';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-diagnostic.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-tenant-data-plane-fleet-diagnostic.mjs', 'utf8');

function preservedFixture(kind) {
  return {
    kind,
    schemaVersion: 4,
    migrationJobs: [],
    activeImportPreserved: true,
    historicalOnboardingPreserved: true,
    lkgPreserved: true
  };
}

describe('retained tenant fleet canary diagnosis', () => {
  it('defaults to exactly the three opaque fixtures retained by the latest failed trusted-main canary', () => {
    expect(RETAINED_FLEET_FIXTURES).toEqual([
      { kind: 'success', tenantId: 't_01dd1cca59866965a1e0' },
      { kind: 'failure', tenantId: 't_eedbd596921ad6eba18c' },
      { kind: 'blocked', tenantId: 't_7911175400766cb6c7b6' }
    ]);
  });

  it('accepts only three distinct opaque workflow-dispatch tenant IDs', () => {
    expect(
      resolveRetainedFleetFixtures({
        RETAINED_FLEET_SUCCESS_TENANT_ID: 't_11111111111111111111',
        RETAINED_FLEET_FAILURE_TENANT_ID: 't_22222222222222222222',
        RETAINED_FLEET_BLOCKED_TENANT_ID: 't_33333333333333333333'
      })
    ).toEqual([
      { kind: 'success', tenantId: 't_11111111111111111111' },
      { kind: 'failure', tenantId: 't_22222222222222222222' },
      { kind: 'blocked', tenantId: 't_33333333333333333333' }
    ]);
    expect(() =>
      resolveRetainedFleetFixtures({ RETAINED_FLEET_SUCCESS_TENANT_ID: 'not-opaque' })
    ).toThrow('fleet_diagnostic_tenant_id_invalid');
    expect(() =>
      resolveRetainedFleetFixtures({
        RETAINED_FLEET_SUCCESS_TENANT_ID: 't_33333333333333333333',
        RETAINED_FLEET_FAILURE_TENANT_ID: 't_33333333333333333333',
        RETAINED_FLEET_BLOCKED_TENANT_ID: 't_44444444444444444444'
      })
    ).toThrow('fleet_diagnostic_tenant_ids_not_unique');
  });

  it('classifies absent Worker platform secrets plus untouched v4 evidence as runtime unconfigured', () => {
    expect(
      classifyFleetDiagnostic({
        fixtures: ['success', 'failure', 'blocked'].map(preservedFixture),
        accountSecretPresent: false,
        tokenSecretPresent: false
      })
    ).toEqual({
      rootCause: 'worker_platform_runtime_unconfigured',
      allJobsAbsent: true,
      allV4LkgPreserved: true,
      blockedImportPreserved: true,
      workerPlatformRuntimeConfigured: false
    });
  });

  it('is a trusted-main read-only workflow and cannot create jobs, enqueue or purge', () => {
    expect(workflow).toContain("default: 't_01dd1cca59866965a1e0'");
    expect(workflow).toContain("default: 't_eedbd596921ad6eba18c'");
    expect(workflow).toContain("default: 't_7911175400766cb6c7b6'");
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
    );
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('/workers/scripts/catalog-engine/settings');
    expect(workflow).toContain('verify-worker-platform-bindings.mjs');
    expect(workflow).toContain('Inspect retained fleet evidence without mutation');
    expect(workflow).not.toContain('wrangler secret put');
    expect(workflow).not.toContain('wrangler secret list');
    expect(script).toContain('readOnly: true');
    expect(script).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE)\b/);
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
  });

  it('checks v4 identity, schema ledger, LKG, override, onboarding and foreign keys', () => {
    expect(script).toContain("schemaVersion === 5 ? '1,2,3,4,5' : '1,2,3,4'");
    expect(script).toContain('schemaVersion === 5 ? STAGE_TABLES.length : 0');
    expect(script).toContain("tenant.lkg?.name === 'Verified LKG Product'");
    expect(script).toContain('tenant.lkg?.override_json');
    expect(script).toContain("control.provisioning?.status === 'success'");
    expect(script).toContain("{ sql: 'PRAGMA foreign_key_check', params: [] }");
    expect(script).toContain('fleetMigrationJobAggregate');
  });
});
