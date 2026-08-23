import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyFleetDiagnostic,
  RETAINED_FLEET_FIXTURES
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
  it('targets exactly the three opaque fixtures retained by the failed trusted-main canary', () => {
    expect(RETAINED_FLEET_FIXTURES).toEqual([
      { kind: 'success', tenantId: 't_3af98441194ad6d97174' },
      { kind: 'failure', tenantId: 't_7df63e951071d2d9938f' },
      { kind: 'blocked', tenantId: 't_d61b367d81eeebf04a7c' }
    ]);
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
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain(
      'secret list --name catalog-engine --config wrangler.jsonc --format json'
    );
    expect(workflow).toContain('Inspect retained fleet evidence without mutation');
    expect(workflow).not.toContain('wrangler secret put');
    expect(script).toContain('readOnly: true');
    expect(script).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE)\b/);
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
  });

  it('checks v4 identity, schema ledger, LKG, override, onboarding and foreign keys', () => {
    expect(script).toContain("tenant.ledger === '1,2,3,4'");
    expect(script).toContain("tenant.lkg?.name === 'Verified LKG Product'");
    expect(script).toContain('tenant.lkg?.override_json');
    expect(script).toContain("control.provisioning?.status === 'success'");
    expect(script).toContain("{ sql: 'PRAGMA foreign_key_check', params: [] }");
    expect(script).toContain('fleetMigrationJobAggregate');
  });
});
