import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';
import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';
import { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v7.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_SOURCE_KEY = 'primary';
const SOURCE_KEY = 'm7d7-canary';
const MERCHANT_OVERRIDE_NAME = 'M7D7 Merchant Override';
const POLL_MS = 5_000;
const DISPATCH_TIMEOUT_MS = 15 * 60_000;
const QUEUE_DRAIN_TIMEOUT_MS = 3 * 60_000;
const MAX_PRODUCTS = 6;
const VERIFICATION_CODE = 'sync_candidate_verified_v1';
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d6_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d6_canary_token_unconfigured');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('m7d6_canary_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1') {
  throw new Error('m7d6_canary_import_automation_must_remain_on');
}
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d6_canary_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d6_canary_active_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('m7d6_canary_sync_cap_must_remain_one');
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
    throw new Error('m7d6_canary_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`m7d6_canary_cloudflare_${code}`);
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
  const suffix = createHash('sha256').update(`m7d7-canary:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    workerScriptName: `ce-${suffix}`,
    databaseName: `cem7d7-${suffix}`,
    dataPlaneKey: `m7d7-${suffix}`
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
  for (const name of QUEUE_NAMES) if (!queues.has(name)) throw new Error('m7d6_canary_queue_missing');
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
  throw new Error('m7d6_canary_queue_did_not_drain');
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
    throw new Error('m7d6_canary_private_source_unavailable');
  }
  if (root.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(root.hostname)) {
    throw new Error('m7d6_canary_private_source_invalid');
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
  throw new Error('m7d6_canary_small_source_scope_not_found');
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

function canonicalSeedStatements(item) {
  return [
    {
      sql: `INSERT INTO catalog_products
              (product_id,name,search_text,category_id,category_name,description,
               source_name,display_name,source_category_name,display_category_name,
               classification_status,classification_confidence)
            VALUES (?1,'M7D6 Last Known Good','m7d6 last known good','legacy','Legacy','healthy',
                    'M7D6 Last Known Good','M7D6 Last Known Good','Legacy','Legacy','automatic',0.99)`,
      params: [item.publicProductId]
    },
    {
      sql: `INSERT INTO catalog_product_classification_overrides
              (product_id,override_json,override_version,updated_at)
            VALUES (?1,?2,7,'2026-08-25 10:00:00')`,
      params: [item.publicProductId, JSON.stringify({ displayName: MERCHANT_OVERRIDE_NAME })]
    }
  ];
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
    {
      sql: `SELECT product_id,name,search_text,category_id,category_name,description,
                   source_name,display_name,source_category_name,display_category_name,
                   team_id,league_id,classification_status,classification_confidence
              FROM catalog_products ORDER BY product_id ASC`,
      params: []
    },
    {
      sql: `SELECT product_id,override_json,override_version,updated_at
              FROM catalog_product_classification_overrides ORDER BY product_id ASC`,
      params: []
    },
    { sql: 'SELECT COUNT(*) AS total FROM catalog_product_intelligence_state', params: [] },
    { sql: 'SELECT COUNT(*) AS total FROM product_media', params: [] }
  ]);
  const catalogRows = result[1]?.results || [];
  return {
    lkgHash: createHash('sha256').update(JSON.stringify(result[0]?.results || [])).digest('hex'),
    lkgCount: (result[0]?.results || []).length,
    catalogHash: createHash('sha256').update(JSON.stringify(catalogRows)).digest('hex'),
    catalogCount: catalogRows.length,
    catalogDisplayName: String(catalogRows[0]?.display_name || ''),
    overrideHash: createHash('sha256').update(JSON.stringify(result[2]?.results || [])).digest('hex'),
    overrideCount: (result[2]?.results || []).length,
    canonicalIntelligenceCount: Number(result[3]?.results?.[0]?.total || 0),
    canonicalProductMediaCount: Number(result[4]?.results?.[0]?.total || 0)
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
  await tenantBatch(fixture.databaseId, canonicalSeedStatements(scope.scan.items[0]));
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
            VALUES (?1, ?2, 'M7D7 Canary', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `m7d7-${fixture.tenantId.slice(2)}`]
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
        worker.versionId || 'm7d7-canary'
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

async function scheduleState(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status,next_sync_at,last_scheduled_at,last_import_id
              FROM tenant_sync_schedules
             WHERE tenant_id=?1 AND source_key=?2 LIMIT 1`,
      params: [fixture.tenantId, SOURCE_KEY]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function stageState(fixture) {
  const result = await tenantBatch(fixture.databaseId, [
    {
      sql: `SELECT state, safety_outcome, observed_count, staged_observation_count,
                   expected_event_count, staged_event_count, expected_detail_count,
                   verification_code, verified_at, last_error_code
              FROM supplier_sync_stage_runs
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN detail_state='complete' THEN 1 ELSE 0 END) AS complete_count,
                   SUM(CASE WHEN detail_state='failed' THEN 1 ELSE 0 END) AS failed_count,
                   SUM(CASE WHEN normalized_evidence_json IS NOT NULL THEN 1 ELSE 0 END) AS evidence_count,
                   SUM(CASE WHEN primary_media_id IS NOT NULL THEN 1 ELSE 0 END) AS primary_media_count,
                   MAX(display_name) AS effective_display_name
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
    {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN override_applied=1 THEN 1 ELSE 0 END) AS override_count,
                   MAX(merchant_override_version) AS override_version,
                   MAX(classifier_version) AS classifier_version,
                   MAX(classifier_key) AS classifier_key
              FROM supplier_sync_stage_classification_state
             WHERE run_id=?1`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN override_applied=1 THEN 1 ELSE 0 END) AS override_count,
                   MAX(classifier_version) AS classifier_version,
                   MAX(classifier_key) AS classifier_key,
                   MAX(knowledge_pack_key) AS knowledge_pack_key,
                   MAX(knowledge_pack_version) AS knowledge_pack_version,
                   MAX(domain_id) AS domain_id
              FROM supplier_sync_stage_intelligence_state
             WHERE run_id=?1`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_sync_stage_catalog_meta
             WHERE run_id=?1 AND key='navigation' AND json_valid(value_json)=1
               AND json_type(value_json)='array' AND json_array_length(value_json)>0`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_sync_stage_catalog_meta
             WHERE run_id=?1 AND key='merchandising' AND json_valid(value_json)=1
               AND json_extract(value_json,'$.projection')='candidate-composed-v1'`,
      params: [fixture.importId]
    },
    {
      sql: `SELECT base_authority_revision
              FROM supplier_sync_stage_authority
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `SELECT revision,last_promoted_run_id,last_promoted_source_key,promoted_at
              FROM catalog_serving_authority
             WHERE tenant_id=?1 LIMIT 1`,
      params: [fixture.tenantId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  const run = result[0]?.results?.[0] || null;
  const details = result[1]?.results?.[0] || {};
  const classification = result[5]?.results?.[0] || {};
  const intelligence = result[6]?.results?.[0] || {};
  return {
    ...run,
    candidateDetailCount: Number(details.total || 0),
    candidateDetailCompleteCount: Number(details.complete_count || 0),
    candidateDetailFailedCount: Number(details.failed_count || 0),
    candidateEvidenceCount: Number(details.evidence_count || 0),
    candidatePrimaryMediaCount: Number(details.primary_media_count || 0),
    effectiveDisplayName: String(details.effective_display_name || ''),
    candidateProductMediaCount: Number(result[2]?.results?.[0]?.total || 0),
    candidateMediaSourceCount: Number(result[3]?.results?.[0]?.total || 0),
    needsDetailEventCount: Number(result[4]?.results?.[0]?.total || 0),
    candidateClassificationCount: Number(classification.total || 0),
    candidateClassificationOverrideCount: Number(classification.override_count || 0),
    candidateOverrideVersion: Number(classification.override_version || 0),
    candidateClassifierVersion: Number(classification.classifier_version || 0),
    candidateClassifierKey: String(classification.classifier_key || ''),
    candidateIntelligenceCount: Number(intelligence.total || 0),
    candidateIntelligenceOverrideCount: Number(intelligence.override_count || 0),
    candidateKnowledgePackKey: String(intelligence.knowledge_pack_key || ''),
    candidateKnowledgePackVersion: Number(intelligence.knowledge_pack_version || 0),
    candidateDomainId: String(intelligence.domain_id || ''),
    candidateNavigationMetaCount: Number(result[7]?.results?.[0]?.total || 0),
    candidateMerchandisingMetaCount: Number(result[8]?.results?.[0]?.total || 0),
    baseAuthorityRevision: Number(result[9]?.results?.[0]?.base_authority_revision ?? -1),
    authorityRevision: Number(result[10]?.results?.[0]?.revision ?? -1),
    authorityRunId: String(result[10]?.results?.[0]?.last_promoted_run_id || ''),
    authoritySourceKey: String(result[10]?.results?.[0]?.last_promoted_source_key || ''),
    authorityPromotedAt: String(result[10]?.results?.[0]?.promoted_at || ''),
    foreignKeyFindings: (result[11]?.results || []).length
  };
}

async function waitForVerifiedCandidate(fixture) {
  const started = Date.now();
  while (Date.now() - started < DISPATCH_TIMEOUT_MS) {
    const job = await controlState(fixture);
    if (!job) throw new Error('m7d6_canary_job_missing');
    if (job.status === 'failed') {
      const safe = String(job.last_error_code || 'm7d6_canary_job_failed');
      throw new Error(/^[a-z0-9_]+$/i.test(safe) ? safe : 'm7d6_canary_job_failed');
    }
    const stage = await stageState(fixture);
    const expected = Number(stage?.expected_detail_count || 0);
    if (
      job.status === 'finalizing' &&
      job.phase === 'finalize' &&
      stage?.state === 'verified' &&
      stage?.verification_code === VERIFICATION_CODE &&
      String(stage?.verified_at || '').trim() &&
      Number(job.completed_detail_count || 0) === expected &&
      stage.candidateClassificationCount === expected &&
      stage.candidateIntelligenceCount === expected &&
      stage.candidateNavigationMetaCount === 1 &&
      stage.candidateMerchandisingMetaCount === 1
    ) {
      return { job, stage };
    }
    await sleep(POLL_MS);
  }
  throw new Error('m7d6_canary_dispatch_timeout');
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
if (!queuesClean(await queueBacklogs(queues))) throw new Error('m7d6_canary_queue_not_empty_at_start');
const scope = await discoverSmallScope();
const fixture = await setupFixture(scope);
const before = await canonicalSnapshot(fixture);

try {
  const state = await waitForVerifiedCandidate(fixture);
  const verifiedSnapshot = await canonicalSnapshot(fixture);
  const scheduleBeforePromotion = await scheduleState(fixture);
  const finalBacklogs = await waitQueuesClean(queues);
  if (before.lkgHash !== verifiedSnapshot.lkgHash || before.lkgCount !== verifiedSnapshot.lkgCount) {
    throw new Error('m7d6_canary_canonical_lkg_changed');
  }
  if (before.catalogHash !== verifiedSnapshot.catalogHash || before.catalogCount !== verifiedSnapshot.catalogCount) {
    throw new Error('m7d6_canary_catalog_changed');
  }
  if (before.overrideHash !== verifiedSnapshot.overrideHash || before.overrideCount !== verifiedSnapshot.overrideCount) {
    throw new Error('m7d6_canary_override_truth_changed');
  }
  if (
    before.canonicalIntelligenceCount !== verifiedSnapshot.canonicalIntelligenceCount ||
    verifiedSnapshot.canonicalIntelligenceCount !== 0
  ) {
    throw new Error('m7d6_canary_canonical_intelligence_changed');
  }
  if (Number(state.stage.expected_detail_count || 0) !== 1) {
    throw new Error('m7d6_canary_affected_detail_count_invalid');
  }
  if (state.stage.needsDetailEventCount !== 1) throw new Error('m7d6_canary_detail_event_count_invalid');
  if (state.stage.candidateDetailCount !== 1 || state.stage.candidateDetailCompleteCount !== 1) {
    throw new Error('m7d6_canary_candidate_detail_invalid');
  }
  if (state.stage.candidateDetailFailedCount !== 0 || state.stage.candidateEvidenceCount !== 1) {
    throw new Error('m7d6_canary_candidate_evidence_invalid');
  }
  if (
    state.stage.candidatePrimaryMediaCount !== 1 ||
    state.stage.candidateMediaSourceCount < 1 ||
    state.stage.candidateProductMediaCount < 1
  ) {
    throw new Error('m7d6_canary_candidate_media_invalid');
  }
  if (
    state.stage.candidateClassificationCount !== 1 ||
    state.stage.candidateIntelligenceCount !== 1 ||
    state.stage.candidateClassifierVersion !== 3 ||
    state.stage.candidateClassifierKey !== 'professional-v3'
  ) {
    throw new Error('m7d6_canary_candidate_cei_invalid');
  }
  if (
    state.stage.candidateClassificationOverrideCount !== 1 ||
    state.stage.candidateIntelligenceOverrideCount !== 1 ||
    state.stage.candidateOverrideVersion !== 7 ||
    state.stage.effectiveDisplayName !== MERCHANT_OVERRIDE_NAME
  ) {
    throw new Error('m7d6_canary_merchant_override_not_reapplied');
  }
  if (
    state.stage.candidateKnowledgePackKey !== 'sports-v1' ||
    state.stage.candidateKnowledgePackVersion !== 1 ||
    state.stage.candidateDomainId !== 'sports'
  ) {
    throw new Error('m7d6_canary_sports_runtime_not_used');
  }
  if (
    state.stage.state !== 'verified' ||
    state.stage.verification_code !== VERIFICATION_CODE ||
    !String(state.stage.verified_at || '').trim() ||
    state.stage.candidateNavigationMetaCount !== 1 ||
    state.stage.candidateMerchandisingMetaCount !== 1
  ) {
    throw new Error('m7d6_canary_candidate_not_verified');
  }
  if (state.stage.foreignKeyFindings !== 0) throw new Error('m7d6_canary_foreign_key_findings');
  if (state.stage.safety_outcome !== 'proceed') throw new Error('m7d6_canary_safety_not_proceed');
  if (Number(state.job.discovered_count || 0) !== 1) throw new Error('m7d6_canary_discovered_count_invalid');
  if (
    state.job.status !== 'finalizing' ||
    state.job.phase !== 'finalize' ||
    Number(state.job.detail_enqueue_cursor || 0) !== 1 ||
    Number(state.job.queued_detail_count || 0) !== 1 ||
    Number(state.job.completed_detail_count || 0) !== 1 ||
    Number(state.job.failed_detail_count || 0) !== 0 ||
    Number(state.job.deferred_detail_count || 0) !== 0
  ) {
    throw new Error('m7d6_canary_control_progress_invalid');
  }
  if (state.stage.baseAuthorityRevision !== 0 || state.stage.authorityRevision !== 0) {
    throw new Error('m7d7_canary_authority_base_invalid');
  }
  if (scheduleBeforePromotion !== null) throw new Error('m7d7_canary_schedule_unexpected_before_promotion');

  const promotion = await processTenantIncrementalPromotion(
    {
      CLOUDFLARE_PLATFORM_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_PLATFORM_API_TOKEN: API_TOKEN,
      CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: DISPATCH_NAMESPACE
    },
    {
      importId: fixture.importId,
      tenantId: fixture.tenantId,
      sourceKey: SOURCE_KEY,
      mode: 'incremental',
      schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
      dataPlane: { databaseId: fixture.databaseId, dispatchNamespace: DISPATCH_NAMESPACE }
    },
    { queryBatch: queryD1Batch }
  );
  if (
    promotion.outcome !== 'success' || promotion.alreadyComplete !== false ||
    promotion.stageState !== 'promoted' || Number(promotion.authorityRevision || 0) !== 1
  ) {
    throw new Error('m7d7_canary_promotion_failed');
  }

  const promotedStage = await stageState(fixture);
  const promotedSnapshot = await canonicalSnapshot(fixture);
  const controlAfterPromotion = await controlState(fixture);
  const scheduleAfterPromotion = await scheduleState(fixture);

  if (before.lkgHash === promotedSnapshot.lkgHash) throw new Error('m7d7_canary_lkg_not_promoted');
  if (before.catalogHash === promotedSnapshot.catalogHash) throw new Error('m7d7_canary_catalog_not_promoted');
  if (
    before.overrideHash !== promotedSnapshot.overrideHash ||
    before.overrideCount !== promotedSnapshot.overrideCount ||
    promotedSnapshot.catalogDisplayName !== MERCHANT_OVERRIDE_NAME
  ) {
    throw new Error('m7d7_canary_override_truth_changed');
  }
  if (promotedSnapshot.canonicalIntelligenceCount !== 1) {
    throw new Error('m7d7_canary_intelligence_not_promoted');
  }
  if (promotedSnapshot.canonicalProductMediaCount < 1) {
    throw new Error('m7d7_canary_media_not_promoted');
  }
  if (
    promotedStage.state !== 'promoted' ||
    promotedStage.baseAuthorityRevision !== 0 ||
    promotedStage.authorityRevision !== 1 ||
    promotedStage.authorityRunId !== fixture.importId ||
    promotedStage.authoritySourceKey !== SOURCE_KEY ||
    !promotedStage.authorityPromotedAt
  ) {
    throw new Error('m7d7_canary_authority_not_committed');
  }
  if (promotedStage.foreignKeyFindings !== 0) throw new Error('m7d7_canary_foreign_key_findings');
  if (
    controlAfterPromotion?.status !== state.job.status ||
    controlAfterPromotion?.phase !== state.job.phase ||
    Number(controlAfterPromotion?.completed_detail_count || 0) !== Number(state.job.completed_detail_count || 0)
  ) {
    throw new Error('m7d7_canary_control_plane_advanced');
  }
  if (scheduleAfterPromotion !== null) throw new Error('m7d7_canary_schedule_advanced');

  const summary = {
    incrementalAffectedDetailCanaryPassed: true,
    incrementalCeiCandidateCanaryPassed: true,
    incrementalCandidateVerificationCanaryPassed: true,
    incrementalPromotionAuthorityCanaryPassed: true,
    manualQueueMessagesProduced: false,
    recurringSyncEnabled: false,
    tenantImportAutomationEnabled: true,
    dispatcherObserved: Number(state.job.attempt_count || 0) >= 1,
    jobStatus: state.job.status,
    jobPhase: state.job.phase,
    stageState: state.stage.state,
    verificationCode: state.stage.verification_code,
    verifiedAtPresent: Boolean(String(state.stage.verified_at || '').trim()),
    safetyOutcome: state.stage.safety_outcome,
    expectedDetailCount: Number(state.stage.expected_detail_count || 0),
    candidateDetailCompleteCount: state.stage.candidateDetailCompleteCount,
    candidateClassificationCount: state.stage.candidateClassificationCount,
    candidateIntelligenceCount: state.stage.candidateIntelligenceCount,
    candidateNavigationMetaCount: state.stage.candidateNavigationMetaCount,
    candidateMerchandisingMetaCount: state.stage.candidateMerchandisingMetaCount,
    classifierVersion: state.stage.candidateClassifierVersion,
    classifierKey: state.stage.candidateClassifierKey,
    knowledgePackKey: state.stage.candidateKnowledgePackKey,
    knowledgePackVersion: state.stage.candidateKnowledgePackVersion,
    domainId: state.stage.candidateDomainId,
    merchantOverrideReapplied: true,
    merchantOverrideVersion: state.stage.candidateOverrideVersion,
    candidateMediaSourceCount: state.stage.candidateMediaSourceCount,
    candidateProductMediaCount: state.stage.candidateProductMediaCount,
    foreignKeyFindings: state.stage.foreignKeyFindings,
    canonicalLkgUnchangedThroughVerification: true,
    canonicalCatalogUnchangedThroughVerification: true,
    canonicalIntelligenceUnchangedThroughVerification: true,
    canonicalLkgPromotedAtomically: true,
    canonicalCatalogPromotedAtomically: true,
    canonicalMerchantOverrideUnchanged: true,
    canonicalIntelligencePromoted: true,
    canonicalProductMediaPromoted: promotedSnapshot.canonicalProductMediaCount,
    promotionPerformed: true,
    promotionAlreadyComplete: promotion.alreadyComplete,
    promotedStageState: promotedStage.state,
    baseAuthorityRevision: promotedStage.baseAuthorityRevision,
    authorityRevision: promotedStage.authorityRevision,
    authorityAdvancedExactlyOnce: promotedStage.authorityRevision === promotedStage.baseAuthorityRevision + 1,
    authorityRunMatch: promotedStage.authorityRunId === fixture.importId,
    controlPlaneStillFinalizing: controlAfterPromotion?.status === 'finalizing' && controlAfterPromotion?.phase === 'finalize',
    cursorAdvanced: false,
    removalActivated: false,
    queueBacklogsClean: queuesClean(finalBacklogs)
  };
  console.log(JSON.stringify(summary, null, 2));
  await cleanupFixture(fixture);
  activeFixture = null;
} catch (error) {
  console.error(
    JSON.stringify({
      incrementalAffectedDetailCanaryPassed: false,
      incrementalCeiCandidateCanaryPassed: false,
      incrementalCandidateVerificationCanaryPassed: false,
      incrementalPromotionAuthorityCanaryPassed: false,
      retainedEvidence: true,
      retainedTenantId: activeFixture?.tenantId || null,
      retainedDatabaseName: activeFixture?.databaseName || null,
      error: /^[a-z0-9_]+$/i.test(String(error?.message || ''))
        ? String(error.message)
        : 'm7d6_canary_failed'
    })
  );
  throw error;
}