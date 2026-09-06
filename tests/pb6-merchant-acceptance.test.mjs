import { expect, it } from 'vitest';
import {
  evaluateMerchantAcceptance,
  safeEvidence
} from '../scripts/cloudflare-pb6-merchant-acceptance.mjs';

const completeRow = {
  tenant_count: 1,
  active_source_count: 1,
  decision_kind: 'full_connected_source',
  decision_status: 'confirmed',
  authority: 'merchant',
  source_bound: 1,
  audit_recorded: 1,
  initial_import_observed: 1,
  initial_import_status: 'success',
  provisioning_current_step: 'import',
  provisioning_status: 'running',
  catalog_status: 'provisioning',
  catalog_schema_ready: 1,
  provider_database_ready: 1,
  provider_worker_ready: 1,
  supplier_source_active: 1,
  active_initial_job: 0,
  scheduler_candidate_ready: 1
};

const runtime = {
  initialImportEnabled: true,
  recurringSyncEnabled: false
};

it('PB6 merchant acceptance passes only with durable merchant authority and initial import evidence', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, runtime);
  expect(evaluation.passed).toBe(true);
  expect(evaluation.checks).toEqual({
    uniqueMerchant: true,
    activeSource: true,
    decisionConfirmed: true,
    merchantAuthority: true,
    sourceBound: true,
    auditRecorded: true,
    initialImportObserved: true,
    initialImportEnabled: true,
    recurringSyncDisabled: true
  });
});

it('system canary authority cannot close the real merchant gate', () => {
  const evaluation = evaluateMerchantAcceptance(
    { ...completeRow, authority: 'system_canary' },
    runtime
  );
  expect(evaluation.passed).toBe(false);
  expect(evaluation.checks.merchantAuthority).toBe(false);
});

it('recurring Intelligent Sync must remain disabled during PB6 acceptance', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, {
    ...runtime,
    recurringSyncEnabled: true
  });
  expect(evaluation.passed).toBe(false);
  expect(evaluation.checks.recurringSyncDisabled).toBe(false);
});

it('safe diagnostics explain scheduler readiness without exposing private identifiers', () => {
  const evaluation = evaluateMerchantAcceptance(
    {
      ...completeRow,
      initial_import_observed: 0,
      initial_import_status: 'missing',
      provisioning_current_step: 'source',
      scheduler_candidate_ready: 0
    },
    runtime
  );
  expect(evaluation.passed).toBe(false);
  expect(evaluation.diagnostics).toEqual({
    provisioningStep: 'source',
    provisioningStatus: 'running',
    catalogStatus: 'provisioning',
    catalogSchemaReady: true,
    providerDatabaseReady: true,
    providerWorkerReady: true,
    supplierSourceActive: true,
    activeInitialJob: false,
    schedulerCandidateReady: false
  });
});

it('safe evidence does not expose tenant, source, database, principal or Cloudflare identifiers', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, runtime);
  const evidence = safeEvidence('CROCCODILOS', evaluation);
  const encoded = JSON.stringify(evidence).toLowerCase();
  for (const forbidden of [
    'tenantId',
    'tenant_id',
    'sourceLocator',
    'source_locator',
    'databaseId',
    'database_id',
    'principalId',
    'principal_id',
    'cloudflare'
  ]) {
    expect(encoded).not.toContain(forbidden.toLowerCase());
  }
  expect(evidence).toEqual({
    pb6MerchantAcceptance: 'passed',
    merchant: 'CROCCODILOS',
    decisionKind: 'full_connected_source',
    authority: 'merchant',
    sourceBound: true,
    auditRecorded: true,
    initialImportObserved: true,
    initialImportStatus: 'success',
    initialImportEnabled: true,
    recurringIntelligentSyncEnabled: false,
    diagnostics: {
      provisioningStep: 'import',
      provisioningStatus: 'running',
      catalogStatus: 'provisioning',
      catalogSchemaReady: true,
      providerDatabaseReady: true,
      providerWorkerReady: true,
      supplierSourceActive: true,
      activeInitialJob: false,
      schedulerCandidateReady: true
    }
  });
});
