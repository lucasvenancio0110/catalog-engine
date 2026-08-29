import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const script = await readFile('scripts/cloudflare-m7d9-removal-canary.mjs', 'utf8');
const workflow = await readFile('.github/workflows/cloudflare-m7d9-removal-canary.yml', 'utf8');
const fleetWorkflow = await readFile(
  '.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml',
  'utf8'
);

describe('M7D9 trusted-main safe-removal canary contract', () => {
  it('keeps PR validation secret-free and production execution on the exact deployed SHA', () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain('Secret-free quality gate');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('Checkout exactly the deployed trusted-main SHA');
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).toContain('catalog-engine/tenant-data-plane-fleet-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-finalization-canary');
    expect(workflow).toContain('catalog-engine/tenant-incremental-safe-removal-canary');
    expect(workflow).toContain('Wait for exact-SHA deploy, fleet v8 and M7D8 regression evidence');
  });

  it('proves the current fleet canary owns v7 to v8 migration before D9 removal proof', () => {
    expect(fleetWorkflow).toContain("'worker/tenant-data-plane-schema-v8.js'");
    expect(fleetWorkflow).toContain('scheduler-owned v7 to v8 fleet maintenance');
    expect(fleetWorkflow).toContain('Cron upgraded isolated v7 tenant to v8');
    expect(fleetWorkflow).toContain('removal schema inert; LKG preserved');
  });

  it('uses isolated Cloudflare D1 fixtures and never produces manual Queue work', () => {
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v8.js'");
    expect(script).toContain('TENANT_DATA_PLANE_SCHEMA_VERSION !== 8');
    expect(script).toContain('createEphemeralDatabase');
    expect(script).toContain("from './d1-batch-chunks.mjs'");
    expect(script).toContain('for (const chunk of splitD1Batch(schemaBootstrap))');
    expect(script).toContain('await d1Batch(fixture.databaseId, chunk)');
    expect(script).toContain('cem7d9-');
    expect(script).toContain('productionBusinessDataMutated: false');
    expect(script).toContain('ephemeralTenantDataPlanes: true');
    expect(script).toContain('manualQueueMessagesProduced: false');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('/purge');
    expect(script).not.toContain('.send(');
    expect(script).not.toContain('.sendBatch(');
  });

  it('proves fail-closed planning, repeated misses, idempotent removal and RESTORED', () => {
    expect(script).toContain("partial.decision?.outcome !== 'preserve_last_known_good'");
    expect(script).toContain("zero.decision?.outcome !== 'quarantine'");
    expect(script).toContain("eventType: 'MISSING'");
    expect(script).toContain("eventType: 'REMOVED'");
    expect(script).toContain("'RESTORED',1,'sync_listing_restored'");
    expect(script).toContain('replay.alreadyComplete !== true');
    expect(script).toContain('m7d9_canary_replay_incremented_miss');
    expect(script).toContain('overrideRetainedAcrossRemoval: true');
    expect(script).toContain('overrideRestoredToCanonical: true');
    expect(script).toContain('firstMissAuthorityRevision: 1');
    expect(script).toContain('removedAuthorityRevision: 3');
    expect(script).toContain('restoredAuthorityRevision: 4');
  });

  it('proves one scope can detach without deleting canonical state owned by another scope', () => {
    expect(script).toContain('SCOPE_B');
    expect(script).toContain("scopeB?.state !== 'active'");
    expect(script).toContain('current.productCount !== 1');
    expect(script).toContain('current.overrideCount !== 1');
    expect(script).toContain('current.retainedOverrideCount !== 0');
    expect(script).toContain("current.albumStatus !== 'active'");
    expect(script).toContain('canonicalProductPreservedByOtherScope: true');
  });

  it('keeps recurring activation off and cleans fixtures only after full success', () => {
    expect(script).toContain("TENANT_SYNC_AUTOMATION_ENABLED");
    expect(script).toContain("TENANT_SYNC_ACTIVE_COHORT");
    expect(script).toContain("TENANT_SYNC_MAX_JOBS_PER_TICK");
    const lifecycleDelete = script.indexOf('await deleteDatabase(lifecycleFixture.databaseId);');
    const scopeDelete = script.indexOf('await deleteDatabase(scopeFixture.databaseId);');
    const successLog = script.indexOf('console.log(JSON.stringify(summary, null, 2));');
    expect(lifecycleDelete).toBeGreaterThan(-1);
    expect(scopeDelete).toBeGreaterThan(lifecycleDelete);
    expect(successLog).toBeGreaterThan(scopeDelete);
    expect(script).toContain('retainedEvidence: true');
    expect(script).toContain('databaseId: fixture.databaseId');
  });
});
