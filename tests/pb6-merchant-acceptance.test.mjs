import assert from 'node:assert/strict';
import test from 'node:test';
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
  initial_import_status: 'success'
};

const runtime = {
  initialImportEnabled: true,
  recurringSyncEnabled: false
};

test('PB6 merchant acceptance passes only with durable merchant authority and initial import evidence', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, runtime);
  assert.equal(evaluation.passed, true);
  assert.deepEqual(evaluation.checks, {
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

test('system canary authority cannot close the real merchant gate', () => {
  const evaluation = evaluateMerchantAcceptance(
    { ...completeRow, authority: 'system_canary' },
    runtime
  );
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.checks.merchantAuthority, false);
});

test('recurring Intelligent Sync must remain disabled during PB6 acceptance', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, {
    ...runtime,
    recurringSyncEnabled: true
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.checks.recurringSyncDisabled, false);
});

test('safe evidence does not expose tenant, source, database, principal or Cloudflare identifiers', () => {
  const evaluation = evaluateMerchantAcceptance(completeRow, runtime);
  const evidence = safeEvidence('CROCCODILOS', evaluation);
  const encoded = JSON.stringify(evidence);
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
    assert.equal(encoded.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  assert.deepEqual(evidence, {
    pb6MerchantAcceptance: 'passed',
    merchant: 'CROCCODILOS',
    decisionKind: 'full_connected_source',
    authority: 'merchant',
    sourceBound: true,
    auditRecorded: true,
    initialImportObserved: true,
    initialImportStatus: 'success',
    initialImportEnabled: true,
    recurringIntelligentSyncEnabled: false
  });
});
