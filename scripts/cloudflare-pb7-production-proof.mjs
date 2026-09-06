import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { buildMerchantProvisioningProgress } from '../worker/portal-provisioning-progress.js';

const DEFAULT_MERCHANT = 'CROCCODILOS';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const SOURCE_KEY = 'primary';
const ALLOWED_PROGRESS_STAGES = new Set([
  'preparing',
  'discovering',
  'importing',
  'finalizing',
  'organizing',
  'checking',
  'ready'
]);

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

async function queryMerchantProgressState({ accountId, apiToken, databaseId, merchant }) {
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
                     AND d.authority='merchant'
                ) THEN 1 ELSE 0 END AS merchant_decision
              `,
        params: [merchant, SOURCE_KEY]
      },
      {
        sql: `SELECT r.status,r.current_step,r.started_at,r.updated_at
                FROM tenant_provisioning_runs r
                JOIN catalog_tenants t ON t.tenant_id=r.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
               ORDER BY r.created_at DESC
               LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT j.status,j.phase,j.discovered_count,j.queued_detail_count,
                    j.completed_detail_count,j.failed_detail_count,j.deferred_detail_count,
                    j.published_product_count,j.next_attempt_at,j.started_at,j.finished_at,j.updated_at
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
                    c.next_attempt_at,c.started_at,c.finished_at,c.updated_at
                FROM tenant_classification_jobs c
                JOIN catalog_tenants t ON t.tenant_id=c.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active'
               ORDER BY c.created_at DESC
               LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT v.status,v.product_count,v.finding_count,v.next_attempt_at,
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

  return {
    prerequisites: firstRow(result, 0),
    provisioning: firstRow(result, 1),
    importJob: firstRow(result, 2),
    classificationJob: firstRow(result, 3),
    verificationJob: firstRow(result, 4)
  };
}

function safeProgress(progress) {
  return {
    version: progress.version,
    stage: progress.stage,
    status: progress.status,
    title: progress.title,
    counters: progress.counters,
    retry: progress.retry?.kind === 'automatic' ? { kind: 'automatic' } : null,
    updatedAt: progress.updatedAt,
    pollAfterMs: progress.pollAfterMs
  };
}

export function evaluatePb7ProductionProof(state, runtime) {
  const prerequisites = state?.prerequisites || {};
  const progress = buildMerchantProvisioningProgress({
    provisioning: state?.provisioning || null,
    importJob: state?.importJob || null,
    classificationJob: state?.classificationJob || null,
    verificationJob: state?.verificationJob || null
  });
  const safe = safeProgress(progress);
  const serialized = JSON.stringify(safe);
  const checks = {
    uniqueMerchant: Number(prerequisites.tenant_count || 0) === 1,
    activeSource: Number(prerequisites.active_source || 0) === 1,
    merchantDecision: Number(prerequisites.merchant_decision || 0) === 1,
    durableProgressObserved: ALLOWED_PROGRESS_STAGES.has(progress.stage),
    merchantReadableStatus: ['waiting', 'running', 'attention', 'complete'].includes(progress.status),
    boundedPolling: Number(progress.pollAfterMs) >= 5000 && Number(progress.pollAfterMs) <= 30000,
    noFakePercentage: !Object.prototype.hasOwnProperty.call(progress, 'percent'),
    noEta: !Object.prototype.hasOwnProperty.call(progress, 'eta'),
    noPrivateLeak: !/t_[a-f0-9]{20}|pv_[a-f0-9]{20}|loc_[a-f0-9]{20}|https?:\/\/|yupoo\.com|source_locator|d1_database_id|dispatch_namespace/i.test(serialized),
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled: runtime?.recurringSyncEnabled === false
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    progress: safe
  };
}

export function safePb7Evidence(merchant, evaluation) {
  return {
    pb7ProductionProof: evaluation.passed ? 'passed' : 'pending',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    stage: evaluation.progress.stage,
    status: evaluation.progress.status,
    counters: evaluation.progress.counters,
    retry: evaluation.progress.retry,
    pollAfterMs: evaluation.progress.pollAfterMs,
    initialImportEnabled: evaluation.checks.initialImportEnabled,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncDisabled,
    privateIdentifiersExposed: !evaluation.checks.noPrivateLeak
  };
}

export async function runPb7ProductionProof() {
  const merchant = String(process.env.PB7_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();

  const first = await queryMerchantProgressState({
    accountId,
    apiToken,
    databaseId: runtime.databaseId,
    merchant
  });
  const firstEvaluation = evaluatePb7ProductionProof(first, runtime);
  if (!firstEvaluation.passed) {
    process.stdout.write(`${JSON.stringify(safePb7Evidence(merchant, firstEvaluation), null, 2)}\n`);
    throw new Error('pb7_production_progress_not_proven');
  }

  // A second independent read proves that leaving/re-entering does not depend on
  // client memory. The state is allowed to advance between reads.
  const second = await queryMerchantProgressState({
    accountId,
    apiToken,
    databaseId: runtime.databaseId,
    merchant
  });
  const secondEvaluation = evaluatePb7ProductionProof(second, runtime);
  const evidence = safePb7Evidence(merchant, secondEvaluation);
  evidence.secondDurableRead = secondEvaluation.passed;
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!secondEvaluation.passed) throw new Error('pb7_second_durable_read_not_proven');
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb7ProductionProof().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
