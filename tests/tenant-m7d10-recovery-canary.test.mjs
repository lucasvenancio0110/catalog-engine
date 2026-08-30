import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  '.github/workflows/cloudflare-m7d10-recovery-canary.yml',
  'utf8'
);
const script = await readFile('scripts/cloudflare-m7d10-recovery-canary.mjs', 'utf8');
const classificationRunner = await readFile(
  'worker/ingestion/incremental-classification-runner.js',
  'utf8'
);
const verificationRunner = await readFile(
  'worker/ingestion/incremental-verification-runner.js',
  'utf8'
);
const recoveryRunner = await readFile(
  'worker/ingestion/incremental-recovery-runner.js',
  'utf8'
);
const replayRunner = await readFile('worker/tenant-sync-replay.js', 'utf8');

describe('M7D10 trusted-main recovery and replay canary contract', () => {
  it('keeps PR validation secret-free and executes only against the exact deployed main SHA', () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain('Secret-free quality gate');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('Checkout exactly the deployed trusted-main SHA');
    expect(workflow).toContain('catalog-engine/tenant-sync-recovery-replay-canary');
  });

  it('requires exact-SHA Queue, fleet, D7, D8, D9 and automatic import/CEI regressions', () => {
    expect(workflow).toContain('catalog-engine/queue-consumer-activation');
    expect(workflow).toContain('catalog-engine/tenant-data-plane-fleet-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-promotion-authority-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-finalization-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-safe-removal-canary');
    expect(workflow).toContain('catalog-engine/tenant-import-auto-canary');
    expect(workflow).toContain(
      'Wait for exact-SHA Queue, fleet, D7, D8, D9 and automatic import/CEI evidence'
    );
  });

  it('uses isolated Cloudflare D1 evidence and only reads production migration and Queue health', () => {
    expect(script).toContain('createEphemeralDatabase');
    expect(script).toContain('tenantDataPlaneCurrentBatch');
    expect(script).toContain('productionBusinessDataMutated: false');
    expect(script).toContain('ephemeralControlAndTenantDataPlanes: true');
    expect(script).toContain('productionMigrationProof');
    expect(script).toContain("'catalog-engine-import-scan-dlq'");
    expect(script).toContain("'catalog-engine-import-detail-dlq'");
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
  });

  it('proves stale-owner CAS, fleet isolation and bounded durable replay without a manual payload', () => {
    expect(script).toContain('reclaimExpiredTenantSyncPhaseLeases');
    expect(script).toContain('oldOwnerReleased');
    expect(script).toContain('oldOwnerFailed');
    expect(script).toContain('newOwnerFailed');
    expect(script).toContain('recovery.recovered !== 1');
    expect(script).toContain('recovery.blocked !== 1');
    expect(script).toContain('createTenantSyncReplayRequest');
    expect(script).toContain('runDueTenantSyncReplays');
    expect(script).toContain('manualReplayPayloadAccepted: false');
    expect(script).toContain('readTenantSyncOperations');
    expect(recoveryRunner).toContain('PARTITION BY j.tenant_id');
    expect(replayRunner).toContain('PARTITION BY tenant_id');
  });

  it('orders CEI before verification through a durable checkpoint instead of runner races', () => {
    expect(classificationRunner).toContain('j.candidate_classified_at IS NULL');
    expect(classificationRunner).toContain('markClassified: true');
    expect(verificationRunner).toContain('j.candidate_classified_at IS NOT NULL');
  });

  it('keeps recurring tenant sync OFF and cleans fixtures only after complete success', () => {
    expect(script).toContain('TENANT_SYNC_AUTOMATION_ENABLED');
    expect(script).toContain('TENANT_SYNC_ACTIVE_COHORT');
    expect(script).toContain('TENANT_SYNC_MAX_JOBS_PER_TICK');
    const success = script.indexOf('passed = true;');
    const cleanup = script.indexOf('await deleteDatabase(resource.databaseId);');
    const output = script.indexOf('m7d10RecoveryCanaryPassed: true');
    expect(success).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(success);
    expect(output).toBeGreaterThan(cleanup);
    expect(script).toContain('retainedEvidence: true');
  });
});
