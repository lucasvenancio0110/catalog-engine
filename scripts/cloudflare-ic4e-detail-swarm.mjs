import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { initialTenantImportId } from '../worker/tenant-import-queue.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v8.js';
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
import { splitD1Batch } from './d1-batch-chunks.mjs';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const REFERENCE_MERCHANT = String(process.env.IC4E_REFERENCE_MERCHANT || 'CROCCODILOS').trim();
const REFERENCE_SOURCE_KEY = 'primary';
const POLL_MS = 10_000;
const PROGRESS_LOG_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 8 * 60_000;
const COMPLETION_TIMEOUT_MS = 100 * 60_000;
const QUEUE_DRAIN_TIMEOUT_MS = 10 * 60_000;
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];
const PRIVATE_EVIDENCE_PATTERN =
  /t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|\.x\.yupoo\.com|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('ic4e_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('ic4e_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('ic4e_dispatch_namespace_invalid');
}
if (!REFERENCE_MERCHANT) throw new Error('ic4e_reference_merchant_missing');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('ic4e_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1') {
  throw new Error('ic4e_requires_initial_import_on');
}
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('ic4e_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('ic4e_recurring_sync_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('ic4e_recurring_sync_limit_changed');
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

function fixtureIdentity() {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${process.env.GITHUB_SHA || 'local'}`;
  const suffix = createHash('sha256').update(`ic4e:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    sourceKey: 'ic4e',
    connectionId: `src_${suffix}`,
    sourceLocatorRef: `loc_${suffix}`,
    workerScriptName: `ce-${suffix}`,
    databaseName: `ceic4e-${suffix}`,
    dataPlaneKey: `ic4e-${suffix}`,
    provisioningId: `p_${suffix}`,
    idempotencyKey: `ic4e:${suffix}`
  };
}

function parseSqliteTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const normalized = /(?:z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function safeJobErrorCode(value) {
  const code = String(value || '').trim();
  return /^(supplier|tenant_import|tenant_data_plane|tenant_classification|tenant_verification|catalog_provider|cloudflare_platform)_[a-z0-9_]+$/i.test(
    code
  )
    ? code
    : null;
}

function safeErrorCode(error) {
  const message = String(error?.message || '');
  return /^ic4e_[a-z0-9_]+$/i.test(message) ? message : 'ic4e_failed';
}

function jobFailure(row, fallbackCode) {
  const error = new Error(fallbackCode);
  error.jobErrorCode = safeJobErrorCode(row?.last_error_code);
  return error;
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API_ORIGIN), {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        accept: 'application/json'
      }
    });
  } catch {
    throw new Error('ic4e_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode)
      ? String(providerCode)
      : String(response.status || 'unknown');
    throw new Error(`ic4e_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
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
  for (const name of QUEUE_NAMES) {
    if (!queues.has(name)) throw new Error('ic4e_queue_missing');
  }
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

function backlogsClean(backlogs) {
  return Object.values(backlogs || {}).every((value) => Number(value || 0) === 0);
}

function safeQueueSummary(backlogs) {
  return {
    primaryBacklog: Number(backlogs?.['catalog-engine-import-scan'] || 0) +
      Number(backlogs?.['catalog-engine-import-detail'] || 0),
    dlqBacklog: Number(backlogs?.['catalog-engine-import-scan-dlq'] || 0) +
      Number(backlogs?.['catalog-engine-import-detail-dlq'] || 0)
  };
}

async function waitQueuesClean(queues, timeoutMs = QUEUE_DRAIN_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const backlogs = await queueBacklogs(queues);
    if (backlogsClean(backlogs)) return backlogs;
    await sleep(POLL_MS);
  }
  throw new Error('ic4e_queue_did_not_drain');
}

async function defaultCatalogCount() {
  const result = await controlBatch([
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  return Number(result[0]?.results?.[0]?.total || 0);
}

async function resolveReference() {
  const result = await controlBatch([
    {
      sql: `WITH target AS (
              SELECT tenant_id
                FROM catalog_tenants
               WHERE UPPER(display_name)=UPPER(?1) AND status='active'
               ORDER BY created_at ASC
               LIMIT 1
            )
            SELECT t.tenant_id, s.provider, s.source_url, p.d1_database_id
              FROM target t
              JOIN supplier_sources s
                ON s.tenant_id=t.tenant_id
               AND s.source_key=?2
               AND s.status IN ('active','error')
              JOIN tenant_data_plane_provider_state p
                ON p.tenant_id=t.tenant_id
               AND p.database_status='active'
               AND p.worker_status='active'
             LIMIT 1`,
      params: [REFERENCE_MERCHANT, REFERENCE_SOURCE_KEY]
    }
  ]);
  const row = result[0]?.results?.[0] || null;
  if (!row) throw new Error('ic4e_reference_missing');
  if (String(row.provider || '') !== 'yupoo') throw new Error('ic4e_reference_provider_invalid');
  if (!String(row.d1_database_id || '').trim()) throw new Error('ic4e_reference_data_plane_missing');
  let source;
  try {
    source = new URL(String(row.source_url || '').trim());
  } catch {
    throw new Error('ic4e_reference_private_source_invalid');
  }
  if (source.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(source.hostname)) {
    throw new Error('ic4e_reference_private_source_invalid');
  }
  return {
    tenantId: String(row.tenant_id),
    databaseId: String(row.d1_database_id),
    sourceUrl: source.href
  };
}

async function referenceSnapshot(reference) {
  const result = await tenantBatch(reference.databaseId, [
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_album_index
             WHERE tenant_id=?1 AND source_key=?2 AND status='active'`,
      params: [reference.tenantId, REFERENCE_SOURCE_KEY]
    },
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  return {
    activeListing: Number(result[0]?.results?.[0]?.total || 0),
    products: Number(result[1]?.results?.[0]?.total || 0)
  };
}

async function setupFixture(reference) {
  const fixture = {
    ...fixtureIdentity(),
    sourceUrl: reference.sourceUrl,
    databaseId: null,
    workerCreated: false,
    controlCreated: false,
    importId: null,
    acceptedAtMs: 0
  };
  activeFixture = fixture;

  const database = await createD1Database({
    ...platformConfig(),
    databaseName: fixture.databaseName
  });
  fixture.databaseId = database.databaseId;

  const schemaBootstrap = tenantDataPlaneCurrentBatch({
    tenantId: fixture.tenantId,
    source: {
      provider: 'yupoo',
      sourceKey: fixture.sourceKey,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
  for (const chunk of splitD1Batch(schemaBootstrap)) {
    await tenantBatch(fixture.databaseId, chunk);
  }

  const worker = await uploadTenantCatalogWorker({
    ...platformConfig(),
    scriptName: fixture.workerScriptName,
    databaseId: fixture.databaseId,
    tenantId: fixture.tenantId
  });
  fixture.workerCreated = true;
  fixture.importId = await initialTenantImportId({
    tenantId: fixture.tenantId,
    sourceKey: fixture.sourceKey
  });

  fixture.acceptedAtMs = Date.now();
  await controlBatch([
    {
      sql: `INSERT INTO catalog_tenants
              (tenant_id, slug, display_name, status, created_at, updated_at)
            VALUES (?1, ?2, 'IC4E Detail Swarm Proof', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `ic4e-${fixture.tenantId.slice(2)}`]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances
              (tenant_id, data_plane_key, status, schema_version, created_at, updated_at)
            VALUES (?1, ?2, 'provisioning', ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.dataPlaneKey, TENANT_DATA_PLANE_SCHEMA_VERSION]
    },
    {
      sql: `INSERT INTO supplier_sources
              (tenant_id, source_key, provider, source_url, status, sync_strategy,
               removal_miss_threshold, created_at, updated_at)
            VALUES (?1, ?2, 'yupoo', ?3, 'active', 'incremental', 3,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO tenant_source_connections
              (connection_id, tenant_id, provider, source_key, source_locator_ref, status,
               sync_strategy, last_health_at, created_at, updated_at)
            VALUES (?1, ?2, 'yupoo', ?3, ?4, 'active', 'incremental', CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.connectionId,
        fixture.tenantId,
        fixture.sourceKey,
        fixture.sourceLocatorRef
      ]
    },
    {
      sql: `INSERT INTO tenant_import_decisions
              (tenant_id, source_key, source_locator_ref, decision_kind, status, authority,
               decided_by_principal_id, confirmed_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'full_connected_source', 'confirmed', 'system_canary', NULL,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.sourceLocatorRef]
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
        worker.versionId || 'ic4e'
      ]
    },
    {
      sql: `INSERT INTO tenant_provisioning_runs
              (provisioning_id, tenant_id, idempotency_key, status, current_step,
               context_json, started_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'running', 'import', '{}', CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.provisioningId, fixture.tenantId, fixture.idempotencyKey]
    },
    {
      sql: `INSERT INTO tenant_provisioning_steps
              (provisioning_id, step_key, status, attempt_count, metadata_json, updated_at)
            VALUES (?1, 'import', 'pending', 0, '{}', CURRENT_TIMESTAMP)`,
      params: [fixture.provisioningId]
    },
    {
      sql: `INSERT INTO tenant_provisioning_steps
              (provisioning_id, step_key, status, attempt_count, metadata_json, updated_at)
            VALUES (?1, 'classify', 'pending', 0, '{}', CURRENT_TIMESTAMP)`,
      params: [fixture.provisioningId]
    },
    {
      sql: `INSERT INTO tenant_provisioning_steps
              (provisioning_id, step_key, status, attempt_count, metadata_json, updated_at)
            VALUES (?1, 'verify', 'pending', 0, '{}', CURRENT_TIMESTAMP)`,
      params: [fixture.provisioningId]
    }
  ]);
  fixture.controlCreated = true;
  return fixture;
}

async function controlJob(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status, phase, attempt_count, discovered_count, detail_enqueue_cursor,
                   queued_detail_count, completed_detail_count, failed_detail_count,
                   deferred_detail_count, published_product_count, last_error_code,
                   created_at, started_at, finished_at
              FROM tenant_import_jobs
             WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
             LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function waitForSchedulerDiscovery(fixture) {
  const started = Date.now();
  while (Date.now() - started < DISCOVERY_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (row) {
      if (row.status === 'failed') throw jobFailure(row, 'ic4e_scheduler_dispatch_failed');
      return row;
    }
    await sleep(POLL_MS);
  }
  throw new Error('ic4e_scheduler_discovery_timeout');
}

async function waitForCompletion(fixture) {
  const started = Date.now();
  let lastProgressLog = 0;
  while (Date.now() - started < COMPLETION_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (!row) throw new Error('ic4e_import_job_missing');
    if (row.status === 'success' && row.phase === 'complete') return row;
    if (row.status === 'failed') throw jobFailure(row, 'ic4e_import_failed');
    if (Date.now() - lastProgressLog >= PROGRESS_LOG_MS) {
      lastProgressLog = Date.now();
      console.error(
        JSON.stringify({
          ic4eProgress: true,
          status: String(row.status || ''),
          phase: String(row.phase || ''),
          discovered: Number(row.discovered_count || 0),
          queued: Number(row.queued_detail_count || 0),
          completed: Number(row.completed_detail_count || 0),
          deferred: Number(row.deferred_detail_count || 0),
          elapsedMs: Date.now() - fixture.acceptedAtMs
        })
      );
    }
    await sleep(POLL_MS);
  }
  throw new Error('ic4e_completion_timeout');
}

async function quiescePostImportFixture(fixture) {
  await controlBatch([
    {
      sql: `UPDATE tenant_provisioning_runs
               SET status='cancelled', current_step='complete', finished_at=CURRENT_TIMESTAMP,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='classify'`,
      params: [fixture.provisioningId, fixture.tenantId]
    },
    {
      sql: `UPDATE tenant_provisioning_steps
               SET status='skipped', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND step_key IN ('classify','verify') AND status='pending'`,
      params: [fixture.provisioningId]
    }
  ]);
}

function detailStateCounts(rows) {
  const counts = { success: 0, skipped: 0, deferred: 0, failed: 0, processing: 0, pending: 0 };
  let firstTerminalAt = 0;
  let lastTerminalAt = 0;
  for (const row of rows || []) {
    const state = String(row?.state || '');
    if (Object.hasOwn(counts, state)) counts[state] += Number(row?.total || 0);
    const first = parseSqliteTimestamp(row?.first_terminal_at);
    const last = parseSqliteTimestamp(row?.last_terminal_at);
    if (first > 0 && (!firstTerminalAt || first < firstTerminalAt)) firstTerminalAt = first;
    if (last > lastTerminalAt) lastTerminalAt = last;
  }
  return { counts, firstTerminalAt, lastTerminalAt };
}

async function verifyDetailSwarm(fixture, finalJob) {
  const result = await tenantBatch(fixture.databaseId, [
    {
      sql: `SELECT COUNT(*) AS total
              FROM supplier_album_index
             WHERE tenant_id=?1 AND source_key=?2 AND status='active'`,
      params: [fixture.tenantId, fixture.sourceKey]
    },
    {
      sql: `SELECT state, COUNT(*) AS total,
                   MIN(CASE WHEN state IN ('success','skipped','deferred') THEN processed_at END) AS first_terminal_at,
                   MAX(CASE WHEN state IN ('success','skipped','deferred') THEN processed_at END) AS last_terminal_at
              FROM supplier_album_detail_state
             WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
             GROUP BY state
             ORDER BY state`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS missing
              FROM supplier_album_index i
              LEFT JOIN supplier_album_detail_state d
                ON d.tenant_id=i.tenant_id
               AND d.source_key=i.source_key
               AND d.album_source_id=i.album_source_id
               AND d.import_id=?3
             WHERE i.tenant_id=?1 AND i.source_key=?2 AND i.status='active'
               AND d.album_source_id IS NULL`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS foreign_rows
              FROM supplier_album_detail_state d
              LEFT JOIN supplier_album_index i
                ON i.tenant_id=d.tenant_id
               AND i.source_key=d.source_key
               AND i.album_source_id=d.album_source_id
             WHERE d.tenant_id=?1 AND d.source_key=?2 AND d.import_id=?3
               AND (i.album_source_id IS NULL OR i.status<>'active')`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.importId]
    },
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
    { sql: 'SELECT COUNT(*) AS total FROM media_sources', params: [] },
    {
      sql: `SELECT COUNT(*) AS rows_total,
                   COALESCE(SUM(CASE WHEN attempt_count>1 THEN attempt_count-1 ELSE 0 END),0) AS retry_excess,
                   COALESCE(MAX(attempt_count),0) AS max_attempts,
                   COALESCE(SUM(CASE WHEN last_error_code IS NOT NULL THEN 1 ELSE 0 END),0) AS error_rows
              FROM supplier_album_detail_state
             WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.importId]
    },
    {
      sql: `SELECT COUNT(*) AS leaks
              FROM catalog_products
             WHERE lower(name) LIKE '%yupoo%'
                OR lower(description) LIKE '%yupoo%'
                OR lower(name) LIKE '%http://%'
                OR lower(name) LIKE '%https://%'
                OR lower(description) LIKE '%http://%'
                OR lower(description) LIKE '%https://%'`,
      params: []
    }
  ]);

  const activeListing = Number(result[0]?.results?.[0]?.total || 0);
  const detail = detailStateCounts(result[1]?.results || []);
  const listingWithoutDetail = Number(result[2]?.results?.[0]?.missing || 0);
  const detailWithoutListing = Number(result[3]?.results?.[0]?.foreign_rows || 0);
  const catalogProducts = Number(result[4]?.results?.[0]?.total || 0);
  const media = Number(result[5]?.results?.[0]?.total || 0);
  const retry = result[6]?.results?.[0] || {};
  const publicLeaks = Number(result[7]?.results?.[0]?.leaks || 0);
  const discovered = Number(finalJob.discovered_count || 0);
  const terminal = detail.counts.success + detail.counts.skipped + detail.counts.deferred;
  const detailRows = Number(retry.rows_total || 0);
  const detailTerminalWindowMs =
    detail.firstTerminalAt > 0 && detail.lastTerminalAt >= detail.firstTerminalAt
      ? detail.lastTerminalAt - detail.firstTerminalAt
      : 0;
  const improvementPct = ic4eImprovementPct(detailTerminalWindowMs);
  const exceptionBudget = ic4eSafeExceptionBudget(discovered);
  const terminalExceptions = detail.counts.skipped + detail.counts.deferred + detail.counts.failed;
  const retryExcess = Number(retry.retry_excess || 0);
  const identityMatch =
    activeListing === discovered &&
    detailRows === discovered &&
    terminal === discovered &&
    listingWithoutDetail === 0 &&
    detailWithoutListing === 0;

  if (discovered < IC4E_MIN_LARGE_CATALOG_PRODUCTS) throw new Error('ic4e_catalog_not_large');
  if (!identityMatch) throw new Error('ic4e_authoritative_identity_mismatch');
  if (detail.counts.failed !== 0) throw new Error('ic4e_detail_failure_budget_exceeded');
  if (terminalExceptions > exceptionBudget) throw new Error('ic4e_exception_budget_exceeded');
  if (retryExcess > exceptionBudget) throw new Error('ic4e_retry_budget_exceeded');
  if (Number(finalJob.attempt_count || 0) > 2) throw new Error('ic4e_scan_retry_budget_exceeded');
  if (catalogProducts !== detail.counts.success) throw new Error('ic4e_published_count_mismatch');
  if (Number(finalJob.published_product_count || 0) !== catalogProducts) {
    throw new Error('ic4e_control_published_count_mismatch');
  }
  if (media < 1) throw new Error('ic4e_media_missing');
  if (publicLeaks !== 0) throw new Error('ic4e_public_leak_detected');
  if (!ic4eMateriallyImproved(detailTerminalWindowMs)) {
    throw new Error('ic4e_material_improvement_not_met');
  }

  return {
    discovered,
    terminal,
    success: detail.counts.success,
    skipped: detail.counts.skipped,
    deferred: detail.counts.deferred,
    failed: detail.counts.failed,
    catalogProducts,
    media,
    identityMatch,
    listingWithoutDetail,
    detailWithoutListing,
    detailTerminalWindowMs,
    terminalProductsPerSecond:
      detailTerminalWindowMs > 0
        ? Math.round((terminal / (detailTerminalWindowMs / 1000)) * 1000) / 1000
        : 0,
    improvementPct,
    exceptionBudget,
    terminalExceptions,
    retryExcess,
    maxDetailAttempts: Number(retry.max_attempts || 0),
    rowsWithSafeErrors: Number(retry.error_rows || 0),
    publicLeaks
  };
}

async function deleteWorker(scriptName) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabase(databaseId) {
  if (!databaseId) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  if (fixture.controlCreated) {
    await controlBatch([
      { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [fixture.tenantId] }
    ]);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName);
  await deleteDatabase(fixture.databaseId);
  if (activeFixture === fixture) activeFixture = null;
}

async function bestEffortCleanup(fixture) {
  if (!fixture) return;
  if (fixture.controlCreated) {
    await controlBatch([
      { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [fixture.tenantId] }
    ]).catch(() => null);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName).catch(() => null);
  await deleteDatabase(fixture.databaseId).catch(() => null);
  if (activeFixture === fixture) activeFixture = null;
}

function assertSafeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (PRIVATE_EVIDENCE_PATTERN.test(serialized)) throw new Error('ic4e_private_evidence_detected');
}

async function main() {
  const queues = await loadQueues();
  const initialBacklogs = await waitQueuesClean(queues);
  const defaultCatalogBefore = await defaultCatalogCount();
  const reference = await resolveReference();
  const referenceBefore = await referenceSnapshot(reference);
  if (referenceBefore.activeListing < IC4E_MIN_LARGE_CATALOG_PRODUCTS) {
    throw new Error('ic4e_reference_not_large');
  }

  let fixture;
  let cleaned = false;
  try {
    fixture = await setupFixture(reference);
    const discovery = await waitForSchedulerDiscovery(fixture);
    const finalJob = await waitForCompletion(fixture);
    await quiescePostImportFixture(fixture);
    const detail = await verifyDetailSwarm(fixture, finalJob);
    const referenceAfter = await referenceSnapshot(reference);
    const defaultCatalogAfter = await defaultCatalogCount();
    if (
      referenceAfter.activeListing !== referenceBefore.activeListing ||
      referenceAfter.products !== referenceBefore.products
    ) {
      throw new Error('ic4e_reference_lkg_changed');
    }
    if (defaultCatalogAfter !== defaultCatalogBefore) {
      throw new Error('ic4e_default_catalog_changed');
    }

    const finalBacklogs = await waitQueuesClean(queues);
    const finalQueueSummary = safeQueueSummary(finalBacklogs);
    if (finalQueueSummary.primaryBacklog !== 0 || finalQueueSummary.dlqBacklog !== 0) {
      throw new Error('ic4e_queue_not_clean');
    }

    const finishedAtMs = parseSqliteTimestamp(finalJob.finished_at);
    const createdAtMs = parseSqliteTimestamp(discovery.created_at);
    if (!finishedAtMs || finishedAtMs < fixture.acceptedAtMs) {
      throw new Error('ic4e_ttfh_timestamp_invalid');
    }
    const ttfhMs = finishedAtMs - fixture.acceptedAtMs;
    const discoveryLatencyMs = createdAtMs
      ? Math.max(0, createdAtMs - fixture.acceptedAtMs)
      : 0;

    await cleanupFixture(fixture);
    cleaned = true;

    const evidence = {
      ic4eProductionDetailSwarmPassed: true,
      contractVersion: IC4E_PROOF_CONTRACT_VERSION,
      referenceClass: IC4E_REFERENCE_CLASS,
      realLargeCatalog: detail.discovered >= IC4E_MIN_LARGE_CATALOG_PRODUCTS,
      manualQueueMessagesProduced: false,
      schedulerDiscovered: true,
      acceptedDecisionIncludesSchedulerWait: true,
      ttfhMs,
      discoveryLatencyMs,
      detailTerminalWindowMs: detail.detailTerminalWindowMs,
      baselineDetailTerminalWindowMs: IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS,
      improvementPct: detail.improvementPct,
      minimumMaterialImprovementPct: IC4E_MIN_MATERIAL_IMPROVEMENT_PCT,
      materiallyImproved: detail.improvementPct >= IC4E_MIN_MATERIAL_IMPROVEMENT_PCT,
      initial120sTargetMs: IC4E_INITIAL_DETAIL_TARGET_MS,
      initial120sTargetMet: ttfhMs <= IC4E_INITIAL_DETAIL_TARGET_MS,
      discovered: detail.discovered,
      terminal: detail.terminal,
      success: detail.success,
      skipped: detail.skipped,
      deferred: detail.deferred,
      failed: detail.failed,
      catalogProducts: detail.catalogProducts,
      media: detail.media,
      terminalProductsPerSecond: detail.terminalProductsPerSecond,
      authoritativeIdentityMatch: detail.identityMatch,
      listingWithoutDetail: detail.listingWithoutDetail,
      detailWithoutListing: detail.detailWithoutListing,
      safeExceptionBudget: detail.exceptionBudget,
      terminalExceptions: detail.terminalExceptions,
      retryExcess: detail.retryExcess,
      maxDetailAttempts: detail.maxDetailAttempts,
      rowsWithSafeErrors: detail.rowsWithSafeErrors,
      schedulerAttemptCount: Number(finalJob.attempt_count || 0),
      queueStartClean: backlogsClean(initialBacklogs),
      queueEndClean: true,
      dlqEndClean: finalQueueSummary.dlqBacklog === 0,
      referenceLkgUnchanged: true,
      defaultCatalogUnchanged: true,
      recurringIntelligentSyncChanged: false,
      privateIdentifiersExposed: false,
      temporaryFixtureCleaned: true
    };
    assertSafeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    const code = safeErrorCode(error);
    const jobErrorCode = safeJobErrorCode(error?.jobErrorCode);
    console.error(
      JSON.stringify({
        ic4eProductionDetailSwarmPassed: false,
        error: code,
        jobErrorCode
      })
    );
    if (fixture && !cleaned) {
      const backlogs = await queueBacklogs(queues).catch(() => null);
      if (backlogs && backlogsClean(backlogs)) {
        await bestEffortCleanup(fixture);
      } else {
        console.error(
          JSON.stringify({
            ic4eFixtureRetained: true,
            reason: 'queue_evidence_not_clean'
          })
        );
      }
    }
    throw new Error(code);
  }
}

await main();
