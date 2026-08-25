import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';
import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v6.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_SOURCE_KEY = 'primary';
const SOURCE_KEY = 'm7d4-canary';
const POLL_MS = 5_000;
const DISPATCH_TIMEOUT_MS = 12 * 60_000;
const QUEUE_DRAIN_TIMEOUT_MS = 3 * 60_000;
const MAX_PRODUCTS = 6;
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d4_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d4_canary_token_unconfigured');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('m7d4_canary_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1') {
  throw new Error('m7d4_canary_import_automation_must_remain_on');
}
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d4_canary_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d4_canary_active_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('m7d4_canary_sync_cap_must_remain_one');
}

let activeFixture = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API_ORIGIN), {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'application/json' }
    });
  } catch {
    throw new Error('m7d4_canary_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`m7d4_canary_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

function fixtureIdentity() {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  const suffix = createHash('sha256').update(`m7d4-canary:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    workerScriptName: `ce-${suffix}`,
    databaseName: `cem7d4-${suffix}`,
    dataPlaneKey: `m7d4-${suffix}`
  };
}

async function loadQueues() {
  const result = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const rows = Array.isArray(result) ? result : [];
  const queues = new Map();
  for (const row of rows) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) queues.set(name, id);
  }
  for (const name of QUEUE_NAMES) if (!queues.has(name)) throw new Error('m7d4_canary_queue_missing');
  return queues;
}

async function queueBacklog(queueId) {
  const result = await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/metrics`
  );
  const metrics = result?.metrics || result || {};
  return Number(metrics.backlog_count || metrics.backlogCount || 0);
}

async function queueBacklogs(queues) {
  const values = {};
  for (const name of QUEUE_NAMES) values[name] = await queueBacklog(queues.get(name));
  return values;
}

function queuesClean(values) {
  return Object.values(values).every((value) => Number(value || 0) === 0);
}

async function waitQueuesClean(queues) {
  const started = Date.now();
  while (Date.now() - started < QUEUE_DRAIN_TIMEOUT_MS) {
    const values = await queueBacklogs(queues);
    if (queuesClean(values)) return values;
    await sleep(POLL_MS);
  }
  throw new Error('m7d4_canary_queue_did_not_drain');
}

async function discoverSmallScope() {
  const result = await controlBatch([
    {
      sql: `SELECT source_url FROM supplier_sources
             WHERE tenant_id=?1 AND source_key=?2 AND status IN ('active','error') LIMIT 1`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY]
    },
    {
      sql: `SELECT source_category_id, COUNT(*) AS total
              FROM supplier_album_index
             WHERE tenant_id=?1 AND source_key=?2 AND status='active'
               AND source_category_id IS NOT NULL
             GROUP BY source_category_id
            HAVING COUNT(*) BETWEEN 1 AND ?3
             ORDER BY total ASC, source_category_id ASC
             LIMIT 50`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY, MAX_PRODUCTS]
    }
  ]);
  let root;
  try {
    root = new URL(String(result[0]?.results?.[0]?.source_url || '').trim());
  } catch {
    throw new Error('m7d4_canary_private_source_unavailable');
  }
  if (root.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(root.hostname)) {
    throw new Error('m7d4_canary_private_source_invalid');
  }
  for (const row of result[1]?.results || []) {
    const categoryId = String(row.source_category_id || '').trim();
    if (!/^\d+$/.test(categoryId)) continue;
    const candidate = new URL(`/categories/${categoryId}`, root.origin);
    candidate.searchParams.set('isSubCate', 'true');
    try {
      const scan = await yupooIngestionProvider.scanListingIndex(candidate.href, {
        maxRootPages: 4,
        maxCategoryPages: 1,
        categoryConcurrency: 1
      });
      if (scan?.complete && scan.items.length >= 1 && scan.items.length <= MAX_PRODUCTS) {
        const first = scan.items[0];
        const detail = await yupooIngestionProvider.fetchDetail(
          { itemUrl: first.sourceUrl, sourceUrl: candidate.href },
          {}
        );
        if (
          detail?.classification?.entityType === 'product' &&
          String(detail.name || '').trim() &&
          Array.isArray(detail.images) &&
          detail.images.length > 0
        ) {
          return { sourceUrl: candidate.href, scan };
        }
      }
    } catch {
      // Try another bounded category scope.
    }
  }
  throw new Error('m7d4_canary_small_source_scope_not_found');
}

function lkgInsert(item, tenantId, sourceKey, forceChanged) {
  const listingFingerprint = forceChanged
    ? createHash('sha256').update(`old:${item.listingFingerprint}`).digest('hex')
    : item.listingFingerprint;
  return {
    sql: `INSERT INTO supplier_album_index
      (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
       source_category_id, source_category_path_json, cover_source_url, image_count_hint,
       listing_fingerprint, detail_fingerprint, status, miss_count,
       first_seen_at, last_seen_at, last_changed_at, updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'active',0,
              CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    params: [
      tenantId,
      sourceKey,
      item.albumSourceId,
      item.publicProductId,
      item.sourceUrl,
      item.sourceTitle,
      item.sourceCategoryId,
      JSON.stringify(item.sourceCategoryPath || []),
      item.coverSourceUrl,
      item.imageCountHint,
      listingFingerprint,
      `detail-canary-${item.albumSourceId}`
    ]
  };
}

async function canonicalSnapshot(fixture) {
  const result = await tenantBatch(fixture.databaseId, [
    {
      sql: `SELECT album_source_id, public_product_id, source_url, source_title,
                   source_category_id, source_category_path_json, cover_source_url,
                   image_count_hint, listing_fingerprint, detail_fingerprint, status, miss_count
              FROM supplier_album_index
             WHERE tenant_id=?1 AND source_key=?2
             ORDER BY album_source_id ASC`,
      params: [fixture.tenantId, SOURCE_KEY]
    },
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  return {
    lkgHash: createHash('sha256').update(JSON.stringify(result[0]?.results || [])).digest('hex'),
    lkgCount: (result[0]?.results || []).length,
    catalogCount: Number(result[1]?.results?.[0]?.total || 0)
  };
}

async function setupFixture(scope) {
  const fixture = {
    ...fixtureIdentity(),
    databaseId: null,
    sourceUrl: scope.sourceUrl,
    importId: null,
    controlCreated: false,
    workerCreated: false
  };
  activeFixture = fixture;
  const database = await createD1Database({ ...platformConfig(), databaseName: fixture.databaseName });
  fixture.databaseId = database.databaseId;
  await tenantBatch(
    fixture.databaseId,
    tenantDataPlaneCurrentBatch({
      tenantId: fixture.tenantId,
      source: {
        provider: 'yupoo',
        sourceKey: SOURCE_KEY,
        sourceUrl: fixture.sourceUrl,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );
  await tenantBatch(
    fixture.databaseId,
    scope.scan.items.map((item, index) => lkgInsert(item, fixture.tenantId, SOURCE_KEY, index === 0))
  );
  const worker = await uploadTenantCatalogWorker({
    ...platformConfig(),
    scriptName: fixture.workerScriptName,
    databaseId: fixture.databaseId,
    tenantId: fixture.tenantId
  });
  fixture.workerCreated = true;
  const scheduledFor = new Date().toISOString().slice(0, 19).replace('T', ' ');
  fixture.importId = await incrementalTenantImportId({
    tenantId: fixture.tenantId,
    sourceKey: SOURCE_KEY,
    scheduledFor
  });
  await controlBatch([
    {
      sql: `INSERT INTO catalog_tenants
              (tenant_id, slug, display_name, status, created_at, updated_at)
            VALUES (?1, ?2, 'M7D4 Canary', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `m7d4-${fixture.tenantId.slice(2)}`]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances
              (tenant_id, data_plane_key, status, schema_version, created_at, updated_at)
            VALUES (?1, ?2, 'ready', ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.dataPlaneKey, TENANT_DATA_PLANE_SCHEMA_VERSION]
    },
    {
      sql: `INSERT INTO supplier_sources
              (tenant_id, source_key, provider, source_url, status, sync_strategy,
               removal_miss_threshold, created_at, updated_at)
            VALUES (?1, ?2, 'yupoo', ?3, 'active', 'incremental', 3,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, SOURCE_KEY, fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO tenant_data_plane_provider_state
              (tenant_id, provider, dispatch_namespace, worker_script_name, d1_database_name,
               d1_database_id, worker_status, database_status, worker_version,
               last_checked_at, created_at, updated_at)
            VALUES (?1, 'cloudflare_wfp', ?2, ?3, ?4, ?5,
                    'active', 'active', ?6, CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        DISPATCH_NAMESPACE,
        fixture.workerScriptName,
        fixture.databaseName,
        fixture.databaseId,
        worker.versionId || 'm7d4-canary'
      ]
    },
    {
      sql: `INSERT INTO tenant_import_jobs
              (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
               next_attempt_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'incremental', 'pending', 'scan', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    }
  ]);
  fixture.controlCreated = true;
  return fixture;
}

async function controlState(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status, phase, attempt_count, discovered_count, detail_enqueue_cursor,
                   queued_detail_count, completed_detail_count, failed_detail_count,
                   deferred_detail_count, last_error_code
              FROM tenant_import_jobs
             WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function stageState(fixture) {
  const result = await tenantBatch(fixture.databaseId, [
    {
      sql: `SELECT state, safety_outcome, observed_count, staged_observation_count,
                   expected_event_count, staged_event_count, expected_detail_count,
                   last_error_code
              FROM supplier_sync_stage_runs
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN detail_state='complete' THEN 1 ELSE 0 END) AS complete_count,
                   SUM(CASE WHEN detail_state='failed' THEN 1 ELSE 0 END) AS failed_count,
                   SUM(CASE WHEN normalized_evidence_json IS NOT NULL THEN 1 ELSE 0 END) AS evidence_count,
                   SUM(CASE WHEN primary_media_id IS NOT NULL THEN 1 ELSE 0 END) AS primary_media_count
              FROM supplier_sync_stage_product_details
             WHERE run_id=?1`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_sync_stage_product_media
             WHERE run_id=?1`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_sync_stage_media_sources
             WHERE run_id=?1 AND active=1`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_sync_stage_events
             WHERE run_id=?1 AND needs_detail=1`,
      params: [fixture.importId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  const run = result[0]?.results?.[0] || null;
  const details = result[1]?.results?.[0] || {};
  return {
    ...run,
    candidateDetailCount: Number(details.total || 0),
    candidateDetailCompleteCount: Number(details.complete_count || 0),
    candidateDetailFailedCount: Number(details.failed_count || 0),
    candidateEvidenceCount: Number(details.evidence_count || 0),
    candidatePrimaryMediaCount: Number(details.primary_media_count || 0),
    candidateProductMediaCount: Number(result[2]?.results?.[0]?.total || 0),
    candidateMediaSourceCount: Number(result[3]?.results?.[0]?.total || 0),
    needsDetailEventCount: Number(result[4]?.results?.[0]?.total || 0),
    foreignKeyFindings: (result[5]?.results || []).length
  };
}

async function waitForStage(fixture) {
  const started = Date.now();
  while (Date.now() - started < DISPATCH_TIMEOUT_MS) {
    const job = await controlState(fixture);
    if (!job) throw new Error('m7d4_canary_job_missing');
    if (job.status === 'failed') {
      const safe = String(job.last_error_code || 'm7d4_canary_job_failed');
      throw new Error(/^[a-z0-9_]+$/i.test(safe) ? safe : 'm7d4_canary_job_failed');
    }
    const stage = await stageState(fixture);
    if (
      job.status === 'details' &&
      job.phase === 'details' &&
      stage?.state === 'details_complete' &&
      Number(job.completed_detail_count || 0) === Number(stage.expected_detail_count || 0)
    ) {
      return { job, stage };
    }
    await sleep(POLL_MS);
  }
  throw new Error('m7d4_canary_dispatch_timeout');
}

async function deleteWorker(scriptName) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabase(databaseId) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function cleanupFixture(fixture) {
  if (fixture.controlCreated) {
    await controlBatch([
      {
        sql: 'DELETE FROM tenant_import_jobs WHERE import_id=?1 AND tenant_id=?2',
        params: [fixture.importId, fixture.tenantId]
      },
      {
        sql: 'DELETE FROM tenant_data_plane_provider_state WHERE tenant_id=?1',
        params: [fixture.tenantId]
      },
      {
        sql: 'DELETE FROM supplier_sources WHERE tenant_id=?1 AND source_key=?2',
        params: [fixture.tenantId, SOURCE_KEY]
      },
      { sql: 'DELETE FROM tenant_catalog_instances WHERE tenant_id=?1', params: [fixture.tenantId] },
      { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [fixture.tenantId] }
    ]);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName);
  if (fixture.databaseId) await deleteDatabase(fixture.databaseId);
}

const queues = await loadQueues();
if (!queuesClean(await queueBacklogs(queues))) throw new Error('m7d4_canary_queue_not_empty_at_start');
const scope = await discoverSmallScope();
const fixture = await setupFixture(scope);
const before = await canonicalSnapshot(fixture);

try {
  const state = await waitForStage(fixture);
  const after = await canonicalSnapshot(fixture);
  const finalBacklogs = await waitQueuesClean(queues);
  if (before.lkgHash !== after.lkgHash || before.lkgCount !== after.lkgCount) {
    throw new Error('m7d4_canary_canonical_lkg_changed');
  }
  if (before.catalogCount !== after.catalogCount) throw new Error('m7d4_canary_catalog_changed');
  if (Number(state.stage.expected_detail_count || 0) !== 1) {
    throw new Error('m7d4_canary_affected_detail_count_invalid');
  }
  if (state.stage.needsDetailEventCount !== 1) throw new Error('m7d4_canary_detail_event_count_invalid');
  if (state.stage.candidateDetailCount !== 1 || state.stage.candidateDetailCompleteCount !== 1) {
    throw new Error('m7d4_canary_candidate_detail_invalid');
  }
  if (state.stage.candidateDetailFailedCount !== 0 || state.stage.candidateEvidenceCount !== 1) {
    throw new Error('m7d4_canary_candidate_evidence_invalid');
  }
  if (
    state.stage.candidatePrimaryMediaCount !== 1 ||
    state.stage.candidateMediaSourceCount < 1 ||
    state.stage.candidateProductMediaCount < 1
  ) {
    throw new Error('m7d4_canary_candidate_media_invalid');
  }
  if (state.stage.foreignKeyFindings !== 0) throw new Error('m7d4_canary_foreign_key_findings');
  if (state.stage.safety_outcome !== 'proceed') throw new Error('m7d4_canary_safety_not_proceed');
  if (Number(state.job.discovered_count || 0) !== 1) throw new Error('m7d4_canary_discovered_count_invalid');
  if (
    Number(state.job.detail_enqueue_cursor || 0) !== 1 ||
    Number(state.job.queued_detail_count || 0) !== 1 ||
    Number(state.job.completed_detail_count || 0) !== 1 ||
    Number(state.job.failed_detail_count || 0) !== 0 ||
    Number(state.job.deferred_detail_count || 0) !== 0
  ) {
    throw new Error('m7d4_canary_control_progress_invalid');
  }
  const summary = {
    incrementalAffectedDetailCanaryPassed: true,
    manualQueueMessagesProduced: false,
    recurringSyncEnabled: false,
    tenantImportAutomationEnabled: true,
    dispatcherObserved: Number(state.job.attempt_count || 0) >= 1,
    jobStatus: state.job.status,
    stageState: state.stage.state,
    safetyOutcome: state.stage.safety_outcome,
    observedCount: Number(state.stage.observed_count || 0),
    stagedObservationCount: Number(state.stage.staged_observation_count || 0),
    stagedEventCount: Number(state.stage.staged_event_count || 0),
    expectedDetailCount: Number(state.stage.expected_detail_count || 0),
    needsDetailEventCount: state.stage.needsDetailEventCount,
    candidateDetailCount: state.stage.candidateDetailCount,
    candidateDetailCompleteCount: state.stage.candidateDetailCompleteCount,
    candidateEvidenceCount: state.stage.candidateEvidenceCount,
    candidateMediaSourceCount: state.stage.candidateMediaSourceCount,
    candidateProductMediaCount: state.stage.candidateProductMediaCount,
    foreignKeyFindings: state.stage.foreignKeyFindings,
    canonicalLkgUnchanged: true,
    storefrontCatalogUnchanged: true,
    queueBacklogsClean: queuesClean(finalBacklogs)
  };
  console.log(JSON.stringify(summary, null, 2));
  await cleanupFixture(fixture);
  activeFixture = null;
} catch (error) {
  console.error(
    JSON.stringify({
      incrementalAffectedDetailCanaryPassed: false,
      retainedEvidence: true,
      retainedTenantId: activeFixture?.tenantId || null,
      retainedDatabaseName: activeFixture?.databaseName || null,
      error: /^[a-z0-9_]+$/i.test(String(error?.message || ''))
        ? String(error.message)
        : 'm7d4_canary_failed'
    })
  );
  throw error;
}
