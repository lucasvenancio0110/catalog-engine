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
    schemaVersion: 5,
    migrationJobs: [],
    migrationCommandVersion: kind === 'blocked' ? 0 : 2,
    activeImportPreserved: true,
    historicalOnboardingPreserved: true,
    lkgPreserved: true,
    candidateRowsCreated: 0,
    foreignKeyFindings: 0
  };
}

describe('retained tenant fleet canary diagnosis', () => {
  it('defaults to exactly the three opaque fixtures retained by the latest failed trusted-main canary', () => {
    expect(RETAINED_FLEET_FIXTURES).toEqual([
      { kind: 'success', tenantId: 't_bbd0a31ebb9924fd5e0d' },
      { kind: 'failure', tenantId: 't_35633dac7b86302d566b' },
      { kind: 'blocked', tenantId: 't_b4ac85a21b382cbeaea6' }
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

  it('classifies absent Worker platform secrets without inventing scheduler success', () => {
    expect(
      classifyFleetDiagnostic({
        fixtures: ['success', 'failure', 'blocked'].map(preservedFixture),
        accountSecretPresent: false,
        tokenSecretPresent: false
      })
    ).toEqual({
      rootCause: 'worker_platform_runtime_unconfigured',
      allJobsAbsent: true,
      allLkgPreserved: true,
      blockedImportPreserved: true,
      workerPlatformRuntimeConfigured: false
    });
  });

  it('classifies expected v5 to v6 outcomes reached after the canary process failed', () => {
    const fixtures = ['success', 'failure', 'blocked'].map(preservedFixture);
    fixtures[0].schemaVersion = 6;
    fixtures[0].migrationJobs = [{ status: 'success', last_error_code: null }];
    fixtures[1].migrationJobs = [
      { status: 'failed', last_error_code: 'tenant_dispatch_namespace_mismatch' }
    ];
    expect(
      classifyFleetDiagnostic({
        fixtures,
        accountSecretPresent: true,
        tokenSecretPresent: true
      }).rootCause
    ).toBe('expected_outcomes_reached_after_canary_failure');
  });

  it('distinguishes a missing trusted capability marker from scheduler discovery', () => {
    const fixtures = ['success', 'failure', 'blocked'].map(preservedFixture);
    fixtures[0].migrationCommandVersion = 0;
    expect(
      classifyFleetDiagnostic({
        fixtures,
        accountSecretPresent: true,
        tokenSecretPresent: true
      }).rootCause
    ).toBe('trusted_preparation_not_committed');
  });

  it('keeps retained-fixture diagnosis explicit and read-only', () => {
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain('success_tenant_id:');
    expect(workflow).toContain('failure_tenant_id:');
    expect(workflow).toContain('blocked_tenant_id:');
    expect(workflow.match(/required: true/g)?.length).toBe(3);
    expect(workflow).not.toContain("default: 't_bbd0a31ebb9924fd5e0d'");
    expect(workflow).not.toContain("default: 't_35633dac7b86302d566b'");
    expect(workflow).not.toContain("default: 't_b4ac85a21b382cbeaea6'");
    expect(script).toContain('migrationCommandSafeError');
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
    );
    expect(workflow).toContain("format('catalog-engine-tenant-fleet-diagnostic-pr-{0}'");
    expect(workflow).toContain("|| 'catalog-engine-production-d1'");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
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

  it('checks v5/v6 identity, ledgers, candidate storage, LKG and foreign keys', () => {
    expect(script).toContain("? '1,2,3,4,5,6' : '1,2,3,4,5'");
    expect(script).toContain('TENANT_SYNC_CANDIDATE_TABLES.length : 0');
    expect(script).toContain('candidateRowCount === 0');
    expect(script).toContain('TENANT_SYNC_CANDIDATE_TABLES.map((table) => ({');
    expect(script).toContain('candidateRows.reduce(');
    expect(script).not.toContain("join(' UNION ALL ')");
    expect(script).toContain("tenant.historicalStage?.state === 'preserved'");
    expect(script).toContain("tenant.lkg?.name === 'Verified LKG Product'");
    expect(script).toContain('tenant.lkg?.override_json');
    expect(script).toContain("control.provisioning?.status === 'success'");
    expect(script).toContain("{ sql: 'PRAGMA foreign_key_check', params: [] }");
    expect(script).toContain('fleetMigrationJobAggregate');
  });
});
