import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { buildMerchantProvisioningProgress } from '../worker/portal-provisioning-progress.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const SOURCE_KEY = 'primary';
const TIMING_CONTRACT = 'instant-catalog-baseline-v1';

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

function firstRow(result, index) {
  return result?.[index]?.results?.[0] || null;
}

async function queryMerchantBaseline({ accountId, apiToken, databaseId, merchant }) {
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
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS tenant_count,
                CASE WHEN EXISTS (
                  SELECT 1
                    FROM tenant_source_connections s
                    JOIN target t ON t.tenant_id=s.tenant_id
                   WHERE s.source_key=?2 AND s.status='active'
                ) THEN 1 ELSE 0 END AS active_source,
                CASE WHEN EXISTS (
                  SELECT 1
                    FROM tenant_import_decisions d
                    JOIN target t ON t.tenant_id=d.tenant_id
                   WHERE d.source_key=?2
                     AND d.decision_kind='full_connected_source'
                     AND d.status='confirmed'
                ) THEN 1 ELSE 0 END AS confirmed_decision,
                (SELECT d.confirmed_at
                   FROM tenant_import_decisions d
                   JOIN target t ON t.tenant_id=d.tenant_id
                  WHERE d.source_key=?2
                    AND d.decision_kind='full_connected_source'
                    AND d.status='confirmed'
                  ORDER BY d.confirmed_at DESC
                  LIMIT 1) AS decision_confirmed_at`,
        params: [merchant, SOURCE_KEY]
      },
      {
        sql: `SELECT j.status,j.phase,j.discovered_count,j.queued_detail_count,
                    j.completed_detail_count,j.failed_detail_count,j.deferred_detail_count,
                    j.published_product_count,j.started_at,j.scan_completed_at,j.finished_at,j.updated_at
                FROM tenant_import_jobs j
                JOIN catalog_tenants t ON t.tenant_id=j.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
                 AND j.source_key=?2
                 AND j.mode='initial'
               ORDER BY j.created_at DESC
               LIMIT 1`,
        params: [merchant, SOURCE_KEY]
      },
      {
        sql: `SELECT c.status,c.product_count,c.automatic_count,c.review_count,c.unknown_count,
                    c.started_at,c.finished_at,c.updated_at
                FROM tenant_classification_jobs c
                JOIN catalog_tenants t ON t.tenant_id=c.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
               ORDER BY c.created_at DESC
               LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT v.status,v.product_count,v.finding_count,
                    v.started_at,v.finished_at,v.updated_at
                FROM tenant_verification_jobs v
                JOIN catalog_tenants t ON t.tenant_id=v.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
               ORDER BY v.created_at DESC
               LIMIT 1`,
        params: [merchant]
      }
    ]
  });

  const prerequisites = firstRow(result, 0);
  return {
    prerequisites,
    importJob: firstRow(result, 1),
    classificationJob: firstRow(result, 2),
    verificationJob: firstRow(result, 3),
    decision: prerequisites?.decision_confirmed_at
      ? { confirmed_at: prerequisites.decision_confirmed_at }
      : null
  };
}

function safeTiming(timing) {
  if (!timing || timing.contract !== TIMING_CONTRACT) return null;
  const milestones = {};
  for (const [key, value] of Object.entries(timing.milestones || {})) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000 * 60 * 60 * 24 * 30) continue;
    milestones[key] = parsed;
  }
  const elapsedMs = Number(timing.elapsedMs);
  if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 1000 * 60 * 60 * 24 * 30) return null;
  return { contract: TIMING_CONTRACT, elapsedMs, milestones };
}

export function evaluateIc1ProductionProof(state, runtime) {
  const prerequisites = state?.prerequisites || {};
  const progress = buildMerchantProvisioningProgress({
    importJob: state?.importJob || null,
    classificationJob: state?.classificationJob || null,
    verificationJob: state?.verificationJob || null,
    decision: state?.decision || null
  });
  const timing = safeTiming(progress.timing);
  const serialized = JSON.stringify({ timing, counters: progress.counters, stage: progress.stage, status: progress.status });
  const checks = {
    uniqueMerchant: Number(prerequisites.tenant_count || 0) === 1,
    activeSource: Number(prerequisites.active_source || 0) === 1,
    confirmedDecision: Number(prerequisites.confirmed_decision || 0) === 1,
    timingContract: timing?.contract === TIMING_CONTRACT,
    decisionToImportMeasured: Number.isInteger(timing?.milestones?.importStartedMs),
    listingScanMeasured: Number.isInteger(timing?.milestones?.listingScannedMs),
    fullImportMeasured: Number.isInteger(timing?.milestones?.importCompletedMs),
    classificationMeasured: Number.isInteger(timing?.milestones?.classificationCompletedMs),
    verificationMeasured: Number.isInteger(timing?.milestones?.verificationCompletedMs),
    readyVerifiedCatalog: progress.stage === 'ready' && progress.status === 'complete',
    productCountObserved: Number(progress.counters?.checked || 0) > 0,
    noPrivateLeak: !/t_[a-f0-9]{20}|pv_[a-f0-9]{20}|loc_[a-f0-9]{20}|https?:\/\/|yupoo\.com|source_locator|database_id|dispatch_namespace|worker/i.test(serialized),
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled: runtime?.recurringSyncEnabled === false
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    timing,
    productCount: Number(progress.counters?.checked || 0),
    findings: Number(progress.counters?.findings || 0)
  };
}

export function safeIc1Evidence(merchant, evaluation) {
  return {
    ic1ProductionProof: evaluation.passed ? 'passed' : 'pending',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    timing: evaluation.timing,
    productCount: evaluation.productCount,
    findings: evaluation.findings,
    initialImportEnabled: evaluation.checks.initialImportEnabled,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncDisabled,
    privateIdentifiersExposed: !evaluation.checks.noPrivateLeak
  };
}

export async function runIc1ProductionProof() {
  const merchant = String(process.env.IC1_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();
  const state = await queryMerchantBaseline({
    accountId,
    apiToken,
    databaseId: runtime.databaseId,
    merchant
  });
  const evaluation = evaluateIc1ProductionProof(state, runtime);
  const evidence = safeIc1Evidence(merchant, evaluation);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evaluation.passed) throw new Error('ic1_production_baseline_not_proven');
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runIc1ProductionProof().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
