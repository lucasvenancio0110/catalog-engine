import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS,
  IC4E_INITIAL_DETAIL_TARGET_MS,
  IC4E_MIN_LARGE_CATALOG_PRODUCTS,
  IC4E_MIN_MATERIAL_IMPROVEMENT_PCT,
  IC4E_PROOF_CONTRACT_VERSION,
  IC4E_REFERENCE_CLASS,
  ic4eImprovementPct,
  ic4eMateriallyImproved,
  ic4eSafeExceptionBudget
} from '../worker/ingestion/ic4e-detail-swarm-proof-contract.js';

const script = await readFile(
  new URL('../scripts/cloudflare-ic4e-detail-swarm.mjs', import.meta.url),
  'utf8'
);
const workflow = await readFile(
  new URL('../.github/workflows/cloudflare-ic4e-detail-swarm.yml', import.meta.url),
  'utf8'
);
const deployWorkflow = await readFile(
  new URL('../.github/workflows/deploy-catalog-api.yml', import.meta.url),
  'utf8'
);

function expectScript(text) {
  expect(script).toContain(text);
}

function expectWorkflow(text) {
  expect(workflow).toContain(text);
}

describe('IC4E production detail-swarm proof contract', () => {
  it('pins a real large-catalog class and a material gate above the IC4A baseline', () => {
    expect(IC4E_PROOF_CONTRACT_VERSION).toBe(1);
    expect(IC4E_REFERENCE_CLASS).toBe('real-large-catalog');
    expect(IC4E_MIN_LARGE_CATALOG_PRODUCTS).toBe(5_000);
    expect(IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS).toBe(6_288_000);
    expect(IC4E_MIN_MATERIAL_IMPROVEMENT_PCT).toBe(20);
    expect(IC4E_INITIAL_DETAIL_TARGET_MS).toBe(120_000);
    expect(ic4eSafeExceptionBudget(6_104)).toBe(62);
    expect(ic4eImprovementPct(IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS)).toBe(0);
    expect(ic4eMateriallyImproved(IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS)).toBe(false);
    expect(ic4eImprovementPct(5_000_000)).toBeGreaterThanOrEqual(20);
    expect(ic4eMateriallyImproved(5_000_000)).toBe(true);
  });

  it('uses the real merchant only server-side and creates an isolated ephemeral tenant data plane', () => {
    expectScript("IC4E_REFERENCE_MERCHANT || 'CROCCODILOS'");
    expectScript('WHERE UPPER(display_name)=UPPER(?1)');
    expectScript("sourceKey: 'ic4e'");
    expectScript('createD1Database');
    expectScript('tenantDataPlaneCurrentBatch');
    expectScript('uploadTenantCatalogWorker');
    expectScript("'IC4E Detail Swarm Proof'");
    expectScript("'full_connected_source', 'confirmed', 'system_canary'");
    expectScript("current_step,\n               context_json");
    expectScript("'running', 'import'");
  });

  it('starts true TTFH before the accepted source decision and never injects Queue messages manually', () => {
    const acceptedIndex = script.indexOf('fixture.acceptedAtMs = Date.now()');
    const decisionIndex = script.indexOf('INSERT INTO tenant_import_decisions');
    expect(acceptedIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeGreaterThan(acceptedIndex);
    expectScript('waitForSchedulerDiscovery(fixture)');
    expectScript('acceptedDecisionIncludesSchedulerWait: true');
    expectScript('manualQueueMessagesProduced: false');
    expect(script).not.toMatch(/queues\/[^'"`]+\/messages/);
    expect(script).not.toContain('TENANT_IMPORT_QUEUE.send(');
    expect(script).not.toContain('TENANT_IMPORT_DETAIL_QUEUE.send(');
  });

  it('compares authoritative listing identity to terminal detail state instead of trusting published count alone', () => {
    expectScript("FROM supplier_album_index i\n              LEFT JOIN supplier_album_detail_state d");
    expectScript("FROM supplier_album_detail_state d\n              LEFT JOIN supplier_album_index i");
    expectScript('activeListing === discovered');
    expectScript('detailRows === discovered');
    expectScript('terminal === discovered');
    expectScript('listingWithoutDetail === 0');
    expectScript('detailWithoutListing === 0');
    expectScript('ic4e_authoritative_identity_mismatch');
    expectScript('catalogProducts !== detail.counts.success');
  });

  it('keeps failure, retry, exception, Queue and DLQ budgets fail closed', () => {
    expectScript('ic4eSafeExceptionBudget(discovered)');
    expectScript("detail.counts.failed !== 0");
    expectScript('terminalExceptions > exceptionBudget');
    expectScript('retryExcess > exceptionBudget');
    expectScript("Number(finalJob.attempt_count || 0) > 2");
    expectScript('waitQueuesClean(queues)');
    expectScript("'catalog-engine-import-scan-dlq'");
    expectScript("'catalog-engine-import-detail-dlq'");
    expectScript('finalQueueSummary.dlqBacklog !== 0');
  });

  it('measures the comparable detail window and separately reports true accepted-decision TTFH', () => {
    expectScript('detailTerminalWindowMs');
    expectScript('IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS');
    expectScript('ic4eMateriallyImproved(detailTerminalWindowMs)');
    expectScript('const ttfhMs = finishedAtMs - fixture.acceptedAtMs');
    expectScript('initial120sTargetMet: ttfhMs <= IC4E_INITIAL_DETAIL_TARGET_MS');
    expectScript('minimumMaterialImprovementPct: IC4E_MIN_MATERIAL_IMPROVEMENT_PCT');
  });

  it('proves the canonical merchant LKG/default catalog remain unchanged and suppresses private evidence', () => {
    expectScript('referenceSnapshot(reference)');
    expectScript('ic4e_reference_lkg_changed');
    expectScript('ic4e_default_catalog_changed');
    expectScript('PRIVATE_EVIDENCE_PATTERN');
    expectScript('assertSafeEvidence(evidence)');
    expectScript('privateIdentifiersExposed: false');
    expectScript('temporaryFixtureCleaned: true');
    expectScript('ic4eFixtureRetained: true');
    expectScript("reason: 'queue_evidence_not_clean'");
    const retainedBlock = script.slice(
      script.indexOf('ic4eFixtureRetained: true'),
      script.indexOf("reason: 'queue_evidence_not_clean'") + 64
    );
    expect(retainedBlock).not.toContain('tenantId');
    expect(retainedBlock).not.toContain('sourceUrl');
    expect(retainedBlock).not.toContain('databaseId');
    expect(retainedBlock).not.toContain('workerScriptName');
  });

  it('keeps recurring Intelligent Sync OFF throughout the proof', () => {
    expectScript("TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0'");
    expectScript("TENANT_SYNC_ACTIVE_COHORT || '') !== ''");
    expectScript("TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1'");
    expectScript('recurringIntelligentSyncChanged: false');
  });

  it('waits for the whole exact-SHA safety chain outside the production mutation lock', () => {
    expectWorkflow("workflows: ['Deploy Catalog Engine application']");
    expectWorkflow('timeout-minutes: 70');
    expectWorkflow('for attempt in $(seq 1 360)');
    for (const context of [
      'catalog-engine/application-deploy',
      'catalog-engine/queue-consumer-activation',
      'catalog-engine/tenant-data-plane-fleet-canary',
      'catalog-engine/tenant-import-auto-canary',
      'catalog-engine/pb9-production-proof',
      'catalog-engine/ic2-production-proof',
      'catalog-engine/ic3-production-proof',
      'catalog-engine/ic4b-detail-fanout',
      'catalog-engine/ic4c-provider-governor',
      'catalog-engine/ic4d-tenant-d1-write-governor'
    ]) {
      expectWorkflow(context);
    }
    const prerequisitesIndex = workflow.indexOf('prerequisites:');
    const proveIndex = workflow.indexOf('prove:');
    const concurrencyIndex = workflow.indexOf('group: catalog-engine-production-d1');
    expect(prerequisitesIndex).toBeGreaterThan(-1);
    expect(proveIndex).toBeGreaterThan(prerequisitesIndex);
    expect(concurrencyIndex).toBeGreaterThan(proveIndex);
  });

  it('runs only aggregate safe evidence in the trusted proof and publishes exact-SHA status', () => {
    expectWorkflow('node scripts/cloudflare-ic4e-detail-swarm.mjs');
    expectWorkflow('.acceptedDecisionIncludesSchedulerWait == true');
    expectWorkflow('.materiallyImproved == true');
    expectWorkflow('.authoritativeIdentityMatch == true');
    expectWorkflow('.terminalExceptions <= .safeExceptionBudget');
    expectWorkflow('.retryExcess <= .safeExceptionBudget');
    expectWorkflow('.dlqEndClean == true');
    expectWorkflow('.referenceLkgUnchanged == true');
    expectWorkflow('.recurringIntelligentSyncChanged == false');
    expectWorkflow('.privateIdentifiersExposed == false');
    expectWorkflow('catalog-engine/ic4e-detail-swarm');
  });

  it('keeps the proof acceptance contract inside the application deploy path graph', () => {
    expect(deployWorkflow).toContain("- 'worker/**'");
    expectScript("../worker/ingestion/ic4e-detail-swarm-proof-contract.js");
    expectWorkflow("- 'worker/ingestion/ic4e-detail-swarm-proof-contract.js'");
  });
});
