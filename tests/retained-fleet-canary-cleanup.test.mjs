import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertRetainedFleetFixture,
  RETAINED_FLEET_CANARY_FIXTURES
} from '../scripts/cloudflare-cleanup-retained-fleet-canaries.mjs';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-cleanup-retained-fleet-canaries.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-cleanup-retained-fleet-canaries.mjs', 'utf8');

describe('retained fleet canary cleanup', () => {
  it('targets the complete unique audited fixture set', () => {
    expect(RETAINED_FLEET_CANARY_FIXTURES).toEqual([
      { kind: 'success', tenantId: 't_bbd0a31ebb9924fd5e0d' },
      { kind: 'failure', tenantId: 't_35633dac7b86302d566b' },
      { kind: 'blocked', tenantId: 't_b4ac85a21b382cbeaea6' }
    ]);
    expect(new Set(RETAINED_FLEET_CANARY_FIXTURES.map((fixture) => fixture.tenantId)).size).toBe(3);
    expect(
      RETAINED_FLEET_CANARY_FIXTURES.filter((fixture) => fixture.kind === 'success')
    ).toHaveLength(1);
    expect(
      RETAINED_FLEET_CANARY_FIXTURES.filter((fixture) => fixture.kind === 'failure')
    ).toHaveLength(1);
    expect(
      RETAINED_FLEET_CANARY_FIXTURES.filter((fixture) => fixture.kind === 'blocked')
    ).toHaveLength(1);
  });

  it('fails closed unless every present row has the deterministic private fixture identity', () => {
    const fixture = { kind: 'success', tenantId: 't_0123456789abcdefabcd' };
    const valid = {
      tenant_id: fixture.tenantId,
      slug: 'fleet-canary-0123456789abcdefabcd',
      display_name: 'Fleet Migration Canary success',
      dispatch_namespace: 'catalog-engine-production',
      worker_script_name: 'ce-0123456789abcdefabcd',
      d1_database_name: 'cefm-0123456789abcdefabcd',
      d1_database_id: '11111111-1111-4111-8111-111111111111',
      source_key: 'fleet-canary',
      provider: 'yupoo',
      source_url: 'https://fleet-canary.invalid/catalog'
    };
    expect(() =>
      assertRetainedFleetFixture(fixture, valid, 'catalog-engine-production')
    ).not.toThrow();
    expect(() =>
      assertRetainedFleetFixture(
        fixture,
        { ...valid, display_name: 'Real Merchant' },
        'catalog-engine-production'
      )
    ).toThrow('fleet_cleanup_display_name_mismatch');
  });

  it('keeps PR validation secret-free and cleanup behind exact trusted-main proof', () => {
    const validateStart = workflow.indexOf('  validate:');
    const cleanupStart = workflow.indexOf('  cleanup:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(cleanupStart).toBeGreaterThan(validateStart);
    expect(workflow.slice(validateStart, cleanupStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).toContain("format('catalog-engine-retained-fleet-cleanup-pr-{0}'");
    expect(workflow).toContain("|| 'catalog-engine-production-d1'");
    expect(workflow).toContain("PROVEN_FLEET_CANARY_RUN_ID: '32735316785'");
    expect(workflow).toContain('after trusted v5-to-v6 proof');
    expect(script).toContain("PROVEN_FLEET_CANARY_RUN_ID = '32735316785'");
    expect(script).toContain("TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0'");
  });

  it('deletes only exact fixture resources and never sends or purges Queue messages', () => {
    expect(script).toContain('DELETE FROM catalog_tenants WHERE tenant_id=?1');
    expect(script).toContain('/workers/dispatch/namespaces/');
    expect(script).toContain('/d1/database/');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toMatch(/DELETE FROM catalog_tenants(?! WHERE tenant_id=\?1)/);
  });
});
