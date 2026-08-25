import { readFile } from 'node:fs/promises';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const SOURCE_KEY = 'm7d4-canary';

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d4_diagnostic_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d4_diagnostic_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('m7d4_diagnostic_dispatch_namespace_invalid');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('m7d4_diagnostic_control_database_invalid');
}

function platformConfig() {
  return { accountId: ACCOUNT_ID, apiToken: API_TOKEN, dispatchNamespace: DISPATCH_NAMESPACE };
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

function rows(result, index) {
  return result[index]?.results || [];
}

function bounded(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

const control = await controlBatch([
  {
    sql: `SELECT j.tenant_id, j.import_id, j.source_key, j.mode, j.status, j.phase,
                 j.attempt_count, j.discovered_count, j.detail_enqueue_cursor,
                 j.queued_detail_count, j.completed_detail_count, j.failed_detail_count,
                 j.deferred_detail_count, j.last_error_code, j.created_at, j.updated_at,
                 p.d1_database_id, p.worker_status, p.database_status
            FROM tenant_import_jobs j
            JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
           WHERE j.mode='incremental'
             AND j.source_key=?1
             AND j.status='failed'
           ORDER BY j.created_at DESC
           LIMIT 1`,
    params: [SOURCE_KEY]
  }
]);

const failedJob = rows(control, 0)[0] || null;
if (!failedJob) throw new Error('m7d4_diagnostic_job_missing');

const tenantId = String(failedJob.tenant_id || '').trim();
const importId = String(failedJob.import_id || '').trim();
const sourceKey = String(failedJob.source_key || '').trim();
const databaseId = String(failedJob.d1_database_id || '').trim();
if (!/^t_[a-f0-9]{20}$/.test(tenantId) || !importId || sourceKey !== SOURCE_KEY) {
  throw new Error('m7d4_diagnostic_job_identity_invalid');
}
if (!/^[a-f0-9-]{32,40}$/i.test(databaseId)) throw new Error('m7d4_diagnostic_database_missing');

const tenant = await tenantBatch(databaseId, [
  {
    sql: `SELECT state, safety_outcome, observed_count, staged_observation_count,
                 expected_event_count, staged_event_count, expected_detail_count,
                 staged_category_count, last_error_code
            FROM supplier_sync_stage_runs
           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
           LIMIT 1`,
    params: [importId, tenantId, sourceKey]
  },
  {
    sql: `SELECT event_type, needs_detail, COUNT(*) AS total
            FROM supplier_sync_stage_events
           WHERE run_id=?1
           GROUP BY event_type, needs_detail
           ORDER BY event_type, needs_detail`,
    params: [importId]
  },
  {
    sql: `SELECT detail_state, outcome_code, last_error_code, attempt_count, COUNT(*) AS total
            FROM supplier_sync_stage_product_details
           WHERE run_id=?1
           GROUP BY detail_state, outcome_code, last_error_code, attempt_count
           ORDER BY detail_state, outcome_code, last_error_code, attempt_count`,
    params: [importId]
  },
  { sql: `SELECT COUNT(*) AS total FROM supplier_sync_stage_product_details WHERE run_id=?1`, params: [importId] },
  { sql: `SELECT COUNT(*) AS total FROM supplier_sync_stage_media_sources WHERE run_id=?1`, params: [importId] },
  { sql: `SELECT COUNT(*) AS total FROM supplier_sync_stage_product_media WHERE run_id=?1`, params: [importId] },
  { sql: `SELECT COUNT(*) AS total FROM supplier_sync_stage_product_categories WHERE run_id=?1`, params: [importId] },
  { sql: `PRAGMA foreign_key_check`, params: [] }
]);

const stage = rows(tenant, 0)[0] || null;
const detailGroups = rows(tenant, 2).map((row) => ({
  state: String(row.detail_state || ''),
  outcomeCode: String(row.outcome_code || '') || null,
  lastErrorCode: String(row.last_error_code || '') || null,
  attemptCount: bounded(row.attempt_count),
  total: bounded(row.total)
}));

console.log(JSON.stringify({
  readOnly: true,
  autoDiscovered: true,
  m7d4RetainedDiagnostic: true,
  tenantId,
  importId,
  sourceKey,
  job: {
    status: String(failedJob.status || ''),
    phase: String(failedJob.phase || ''),
    attemptCount: bounded(failedJob.attempt_count),
    discoveredCount: bounded(failedJob.discovered_count),
    detailEnqueueCursor: bounded(failedJob.detail_enqueue_cursor),
    queuedDetailCount: bounded(failedJob.queued_detail_count),
    completedDetailCount: bounded(failedJob.completed_detail_count),
    failedDetailCount: bounded(failedJob.failed_detail_count),
    deferredDetailCount: bounded(failedJob.deferred_detail_count),
    lastErrorCode: String(failedJob.last_error_code || '') || null
  },
  dataPlane: {
    workerStatus: String(failedJob.worker_status || ''),
    databaseStatus: String(failedJob.database_status || '')
  },
  stage: stage ? {
    state: String(stage.state || ''),
    safetyOutcome: String(stage.safety_outcome || ''),
    observedCount: bounded(stage.observed_count),
    stagedObservationCount: bounded(stage.staged_observation_count),
    expectedEventCount: bounded(stage.expected_event_count),
    stagedEventCount: bounded(stage.staged_event_count),
    expectedDetailCount: bounded(stage.expected_detail_count),
    stagedCategoryCount: bounded(stage.staged_category_count),
    lastErrorCode: String(stage.last_error_code || '') || null
  } : null,
  events: rows(tenant, 1).map((row) => ({
    eventType: String(row.event_type || ''),
    needsDetail: bounded(row.needs_detail),
    total: bounded(row.total)
  })),
  candidateDetails: {
    total: bounded(rows(tenant, 3)[0]?.total),
    groups: detailGroups,
    mediaSources: bounded(rows(tenant, 4)[0]?.total),
    productMedia: bounded(rows(tenant, 5)[0]?.total),
    productCategories: bounded(rows(tenant, 6)[0]?.total)
  },
  foreignKeyFindings: rows(tenant, 7).length
}, null, 2));
