import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ic2ProductionProofCanaryContract } from '../worker/ic2-production-proof-canary.js';

const workflow = fs.readFileSync('.github/workflows/cloudflare-ic2-production-proof.yml', 'utf8');
const canary = fs.readFileSync('worker/ic2-production-proof-canary.js', 'utf8');

describe('IC2 production proof contract', () => {
  it('measures the real fresh-tenant L0 threshold without weakening it', () => {
    expect(ic2ProductionProofCanaryContract.readinessThreshold).toBe(12);
    expect(ic2ProductionProofCanaryContract.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(ic2ProductionProofCanaryContract.timeoutMs).toBeLessThanOrEqual(90_000);
    expect(ic2ProductionProofCanaryContract.pollMs).toBeGreaterThanOrEqual(50);
    expect(canary).toContain('handlePortalImportDecisionRequest');
    expect(canary).toContain("authority !== 'merchant'");
    expect(canary).toContain("last.productCount > 0");
    expect(canary).toContain("last.ready === true");
    expect(canary).toContain('freshTenant: true');
  });

  it('uses the production Queue and external production construction namespace only from trusted CI', () => {
    expect(workflow).toContain("queue: 'catalog-engine-instant-seed'");
    expect(workflow).toContain("name: 'TENANT_CONSTRUCTION_STATE'");
    expect(workflow).toContain("class_name: 'TenantConstructionState'");
    expect(workflow).toContain("script_name: 'catalog-engine'");
    expect(workflow).toContain('--secrets-file "$SECRET_FILE"');
    expect(workflow).toContain('openssl rand -hex 32');
    expect(workflow).toContain("STATUS_CONTEXT: catalog-engine/ic2-production-proof");
  });

  it('cannot run the production proof from an un-deployed pull request or ordinary push', () => {
    expect(workflow).toContain("github.event_name == 'workflow_run'");
    expect(workflow).toContain('github.event.workflow_run.conclusion == \'success\'');
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).not.toContain("github.event_name == 'push'");
    expect(workflow).toContain("github.event_name == 'pull_request'");
  });

  it('waits for the ephemeral workers.dev route before starting TTFI measurement', () => {
    expect(workflow).toContain('Wait for ephemeral proof route readiness');
    expect(workflow).toContain('for attempt in $(seq 1 30)');
    expect(workflow).toContain('ic2_proof_worker_ready=true');
    expect(workflow).toContain(".error == \"not_found\"");
    expect(workflow.indexOf('Wait for ephemeral proof route readiness')).toBeLessThan(
      workflow.indexOf('Measure fresh-tenant TTFI and TTFC in production')
    );
  });

  it('allows the ephemeral proof Worker to verify the real public anonymous boundary without 1042', () => {
    expect(workflow).toContain("'global_fetch_strictly_public'");
    expect(workflow).toContain('compatibility_flags: [...new Set(');
    expect(canary).toContain('https://app.catalogoengine.com/api/admin/stores/${fixture.tenantId}/construction-preview');
    expect(canary).toContain("if (![401, 403].includes(anonymous.status))");
  });

  it('proves membership isolation and the real unauthenticated production boundary', () => {
    expect(canary).toContain('crossTenantFailClosed: true');
    expect(canary).toContain('defaultTenantFailClosed: true');
    expect(canary).toContain('anonymousFailClosed: true');
    expect(canary).toContain("if (cross.status !== 404)");
    expect(canary).toContain("if (defaultAccess.status !== 404)");
  });

  it('keeps supplier and runtime locators out of returned evidence and logs', () => {
    expect(canary).toContain('PRIVATE_EVIDENCE');
    expect(canary).toContain("throw new Error('ic2_proof_private_leak')");
    expect(canary).not.toMatch(/console\.(?:log|info|debug)\s*\(/);
    expect(workflow).toContain('/tmp/ic2-production-proof-safe.json');
    expect(workflow).toContain('privateIdentifiersExposed');
    expect(workflow).not.toContain('cat /tmp/ic2-proof-deploy.log');
  });

  it('cleans both the fresh control-plane fixture and ephemeral Worker', () => {
    expect(canary).toContain("DELETE FROM tenant_import_decisions WHERE tenant_id=?1");
    expect(canary).toContain("DELETE FROM catalog_tenants WHERE tenant_id=?1");
    expect(canary).toContain("fetch('https://construction.internal/state', { method: 'DELETE' })");
    expect(workflow).toContain('Delete ephemeral proof Worker');
    expect(workflow).toContain('/workers/scripts/$WORKER_NAME');
    expect(workflow).toContain('if: always()');
  });

  it('waits for PB9 LKG evidence on the same exact deployed SHA before publishing green', () => {
    expect(workflow).toContain('catalog-engine/pb9-production-proof');
    expect(workflow).toContain('for attempt in $(seq 1 36)');
    expect(workflow).toContain('pb9_verified_lkg=success');
    expect(workflow).toContain('statuses/$TARGET_SHA');
  });
});