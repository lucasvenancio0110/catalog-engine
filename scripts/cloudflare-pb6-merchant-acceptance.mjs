import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const DECISION_KIND = 'full_connected_source';
const SOURCE_KEY = 'primary';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function loadRuntimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('catalog_db_config_missing');
  return {
    databaseId: String(database.database_id),
    initialImportEnabled: String(config.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') === '1',
    recurringSyncEnabled: String(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1'
  };
}

export function evaluateMerchantAcceptance(row, runtime) {
  const state = row || {};
  const checks = {
    uniqueMerchant: Number(state.tenant_count || 0) === 1,
    activeSource: Number(state.active_source_count || 0) === 1,
    decisionConfirmed:
      state.decision_kind === DECISION_KIND && state.decision_status === 'confirmed',
    merchantAuthority: state.authority === 'merchant',
    sourceBound: Number(state.source_bound || 0) === 1,
    auditRecorded: Number(state.audit_recorded || 0) === 1,
    initialImportObserved: Number(state.initial_import_observed || 0) === 1,
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled: runtime?.recurringSyncEnabled === false
  };
  const diagnostics = {
    provisioningStep: String(state.provisioning_current_step || 'missing'),
    provisioningStatus: String(state.provisioning_status || 'missing'),
    catalogStatus: String(state.catalog_status || 'missing'),
    catalogSchemaReady: Number(state.catalog_schema_ready || 0) === 1,
    providerDatabaseReady: Number(state.provider_database_ready || 0) === 1,
    providerWorkerReady: Number(state.provider_worker_ready || 0) === 1,
    supplierSourceActive: Number(state.supplier_source_active || 0) === 1,
    activeInitialJob: Number(state.active_initial_job || 0) === 1,
    schedulerCandidateReady: Number(state.scheduler_candidate_ready || 0) === 1
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    diagnostics,
    initialImportStatus: String(state.initial_import_status || 'missing')
  };
}

export function safeEvidence(merchant, evaluation) {
  return {
    pb6MerchantAcceptance: evaluation.passed ? 'passed' : 'pending',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    decisionKind: DECISION_KIND,
    authority: evaluation.checks.merchantAuthority ? 'merchant' : 'not_proven',
    sourceBound: evaluation.checks.sourceBound,
    auditRecorded: evaluation.checks.auditRecorded,
    initialImportObserved: evaluation.checks.initialImportObserved,
    initialImportStatus: evaluation.initialImportStatus,
    initialImportEnabled: evaluation.checks.initialImportEnabled,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncDisabled,
    diagnostics: evaluation.diagnostics
  };
}

function schedulerCandidateReady(state) {
  return (
    state.provisioning_current_step === 'import' &&
    ['running', 'failed', 'blocked'].includes(state.provisioning_status) &&
    state.catalog_status === 'provisioning' &&
    Number(state.catalog_schema_ready || 0) === 1 &&
    Number(state.provider_database_ready || 0) === 1 &&
    Number(state.provider_worker_ready || 0) === 1 &&
    Number(state.supplier_source_active || 0) === 1 &&
    Number(state.active_source_count || 0) === 1 &&
    state.decision_kind === DECISION_KIND &&
    state.decision_status === 'confirmed' &&
    Number(state.source_bound || 0) === 1 &&
    Number(state.active_initial_job || 0) === 0
  );
}

async function queryMerchantState({ accountId, apiToken, databaseId, merchant }) {
  const metadata = JSON.stringify({ decisionKind: DECISION_KIND, authority: 'merchant' });
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [
      {
        sql: `WITH target AS (
                SELECT tenant_id
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1)
                   AND status='active'
              ),
              active_source AS (
                SELECT c.tenant_id,c.source_key,c.source_locator_ref
                  FROM tenant_source_connections c
                  JOIN target t ON t.tenant_id=c.tenant_id
                 WHERE c.source_key=?2 AND c.status='active'
              ),
              decision AS (
                SELECT d.tenant_id,d.source_key,d.source_locator_ref,d.decision_kind,
                       d.status AS decision_status,d.authority,d.confirmed_at
                  FROM tenant_import_decisions d
                  JOIN target t ON t.tenant_id=d.tenant_id
                 WHERE d.source_key=?2
              ),
              latest_initial AS (
                SELECT j.tenant_id,j.source_key,j.import_id,j.status,j.created_at
                  FROM tenant_import_jobs j
                  JOIN target t ON t.tenant_id=j.tenant_id
                 WHERE j.source_key=?2 AND j.mode='initial'
                 ORDER BY j.created_at DESC
                 LIMIT 1
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS tenant_count,
                (SELECT COUNT(*) FROM active_source) AS active_source_count,
                d.decision_kind,
                d.decision_status,
                d.authority,
                CASE WHEN s.source_locator_ref IS NOT NULL
                           AND d.source_locator_ref=s.source_locator_ref THEN 1 ELSE 0 END AS source_bound,
                CASE WHEN EXISTS (
                  SELECT 1
                    FROM tenant_audit_log a
                   WHERE a.tenant_id=t.tenant_id
                     AND a.action='tenant.import_decision.confirmed'
                     AND a.target_type='source'
                     AND a.target_id=?2
                     AND a.metadata_json=?3
                ) THEN 1 ELSE 0 END AS audit_recorded,
                CASE WHEN j.import_id IS NOT NULL
                           AND d.confirmed_at IS NOT NULL
                           AND datetime(j.created_at) >= datetime(d.confirmed_at)
                     THEN 1 ELSE 0 END AS initial_import_observed,
                COALESCE(j.status,'missing') AS initial_import_status
              FROM target t
              LEFT JOIN active_source s ON s.tenant_id=t.tenant_id
              LEFT JOIN decision d ON d.tenant_id=t.tenant_id AND d.source_key=?2
              LEFT JOIN latest_initial j ON j.tenant_id=t.tenant_id AND j.source_key=?2
              LIMIT 1`,
        params: [merchant, SOURCE_KEY, metadata]
      },
      {
        sql: `SELECT
                COALESCE((
                  SELECT r.current_step
                    FROM tenant_provisioning_runs r
                   WHERE r.tenant_id=t.tenant_id
                   ORDER BY r.created_at DESC
                   LIMIT 1
                ), 'missing') AS provisioning_current_step,
                COALESCE((
                  SELECT r.status
                    FROM tenant_provisioning_runs r
                   WHERE r.tenant_id=t.tenant_id
                   ORDER BY r.created_at DESC
                   LIMIT 1
                ), 'missing') AS provisioning_status
              FROM catalog_tenants t
             WHERE UPPER(t.display_name)=UPPER(?1)
               AND t.status='active'
             LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT
                COALESCE(i.status,'missing') AS catalog_status,
                CASE WHEN COALESCE(i.schema_version,0) >= 3 THEN 1 ELSE 0 END AS catalog_schema_ready,
                CASE WHEN p.database_status='active' AND p.d1_database_id IS NOT NULL THEN 1 ELSE 0 END AS provider_database_ready,
                CASE WHEN p.worker_status='active' THEN 1 ELSE 0 END AS provider_worker_ready
              FROM catalog_tenants t
              LEFT JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
              LEFT JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
             WHERE UPPER(t.display_name)=UPPER(?1)
               AND t.status='active'
             LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT
                CASE WHEN EXISTS (
                  SELECT 1
                    FROM supplier_sources s
                   WHERE s.tenant_id=t.tenant_id
                     AND s.source_key=?2
                     AND s.status='active'
                ) THEN 1 ELSE 0 END AS supplier_source_active,
                CASE WHEN EXISTS (
                  SELECT 1
                    FROM tenant_import_jobs j
                   WHERE j.tenant_id=t.tenant_id
                     AND j.source_key=?2
                     AND j.mode='initial'
                     AND j.status IN ('pending','queued','scanning','details','finalizing')
                ) THEN 1 ELSE 0 END AS active_initial_job
              FROM catalog_tenants t
             WHERE UPPER(t.display_name)=UPPER(?1)
               AND t.status='active'
             LIMIT 1`,
        params: [merchant, SOURCE_KEY]
      }
    ]
  });

  const state = {
    ...(result?.[0]?.results?.[0] || {}),
    ...(result?.[1]?.results?.[0] || {}),
    ...(result?.[2]?.results?.[0] || {}),
    ...(result?.[3]?.results?.[0] || {})
  };
  state.scheduler_candidate_ready = schedulerCandidateReady(state) ? 1 : 0;
  return state;
}

export async function runPb6MerchantAcceptance() {
  const merchant = String(process.env.PB6_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();
  const row = await queryMerchantState({
    accountId,
    apiToken,
    databaseId: runtime.databaseId,
    merchant
  });
  const evaluation = evaluateMerchantAcceptance(row, runtime);
  const evidence = safeEvidence(merchant, evaluation);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evaluation.passed) throw new Error('pb6_merchant_acceptance_not_proven');
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb6MerchantAcceptance().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
