import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCatalogProviderDetailResult
} from '../src/catalog-provider/provider-contract.js';
import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';
import { buildTenantProductWriteBatch } from '../worker/ingestion/detail-consumer.js';
import { resolveCatalogIngestionProvider } from '../worker/ingestion/providers/index.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v8.js';
import { splitD1Batch } from './d1-batch-chunks.mjs';

const API_ORIGIN = 'https://api.cloudflare.com';
const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const DEFAULT_MERCHANT = 'CROCCODILOS';
const DEFAULT_SOURCE_KEY = 'primary';
const DEFAULT_SAMPLE_SIZE = 6;
const MAX_SAMPLE_SIZE = 8;
const CANDIDATE_MULTIPLIER = 3;
const DETAIL_QUEUE = 'catalog-engine-import-detail';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const PRIVATE_EVIDENCE_PATTERN =
  /t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo(?:\.com)?|source[_-]?(?:url|id|locator)|album[_-]?source[_-]?id|d1[_-]?(?:database[_-]?)?id|worker[_-]?(?:script|locator)|dispatch[_-]?namespace|api[_-]?token|authorization|credential|password|secret/i;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function requiredEnv(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`ic4a_${name.toLowerCase()}_missing`);
  return value;
}

function safeCode(error) {
  const value = String(error?.code || error?.message || error || '').trim().toLowerCase();
  if (/^[a-z0-9_]{1,80}$/.test(value)) return value;
  return 'detail_sample_failed';
}

function parseSqliteTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const normalized = /(?:z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

export function durationSummary(values) {
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => positiveNumber(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!rows.length) return { count: 0, minMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const percentile = (p) => rows[Math.max(0, Math.ceil(rows.length * p) - 1)];
  const round = (value) => Math.round(value * 10) / 10;
  return {
    count: rows.length,
    minMs: round(rows[0]),
    meanMs: round(rows.reduce((sum, value) => sum + value, 0) / rows.length),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(rows.at(-1))
  };
}

function numericSummary(values) {
  return durationSummary(values);
}

function sourcePathIds(row) {
  try {
    const parsed = JSON.parse(String(row?.source_category_path_json || '[]'));
    return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildCategoryPath(row, categoryById) {
  const ids = sourcePathIds(row);
  const output = [];
  for (let index = 0; index < ids.length; index += 1) {
    const sourceId = ids[index];
    const category = categoryById.get(sourceId);
    output.push({
      sourceId,
      name: String(category?.name || 'Outros').trim() || 'Outros',
      parentSourceId: category?.parent_source_id ? String(category.parent_source_id) : null,
      depth: Math.max(0, Number(category?.depth ?? index))
    });
  }
  return output;
}

function fixtureIdentity(env = process.env) {
  const seed = `${env.GITHUB_RUN_ID || Date.now()}:${env.GITHUB_RUN_ATTEMPT || '1'}:${env.GITHUB_SHA || 'local'}`;
  const suffix = createHash('sha256').update(`ic4a:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    importId: `imp_${suffix}`,
    sourceKey: 'ic4a',
    databaseName: `ceic4a-${suffix}`,
    databaseId: null
  };
}

async function loadRepositoryConfig() {
  const [wranglerRaw, detailRaw] = await Promise.all([
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../wrangler.import-detail.jsonc', import.meta.url), 'utf8')
  ]);
  const wrangler = JSON.parse(wranglerRaw);
  const detail = JSON.parse(detailRaw);
  const controlDatabaseId = String(
    wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
  ).trim();
  const consumer = detail.queues?.consumers?.find((entry) => entry.queue === DETAIL_QUEUE);
  return {
    controlDatabaseId,
    initialImportEnabled: String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') === '1',
    recurringSyncEnabled: String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1',
    recurringSyncCohort: String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || ''),
    recurringSyncMaxJobs: String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || ''),
    detailQueue: {
      batchSize: integer(consumer?.max_batch_size),
      batchTimeoutSeconds: integer(consumer?.max_batch_timeout),
      maxConcurrency: integer(consumer?.max_concurrency),
      maxRetries: integer(consumer?.max_retries)
    }
  };
}

function platformConfig({ accountId, apiToken, dispatchNamespace }) {
  return { accountId, apiToken, dispatchNamespace };
}

async function cloudflareRequest(
  accountId,
  apiToken,
  pathname,
  { method = 'GET', allowNotFound = false } = {}
) {
  const response = await fetch(new URL(pathname, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: { authorization: `Bearer ${apiToken}`, accept: 'application/json' }
  }).catch(() => null);
  if (!response) throw new Error('ic4a_cloudflare_unreachable');
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`ic4a_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function deleteDatabase(accountId, apiToken, databaseId) {
  if (!databaseId) return true;
  await cloudflareRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
  return true;
}

async function queueInventory(accountId, apiToken) {
  const rows = await cloudflareRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues?per_page=100`
  );
  const byName = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) byName.set(name, id);
  }
  if (!byName.has(DETAIL_QUEUE) || !byName.has(DETAIL_DLQ)) {
    throw new Error('ic4a_detail_queue_missing');
  }
  return byName;
}

async function realtimeQueueMetric(accountId, apiToken, queueId) {
  const result = await cloudflareRequest(
    accountId,
    apiToken,
    `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/metrics`
  );
  const metrics = result?.metrics || result || {};
  const oldestTimestamp = positiveNumber(
    metrics.oldest_message_timestamp_ms ?? metrics.oldestMessageTimestampMs
  );
  return {
    backlogCount: integer(metrics.backlog_count ?? metrics.backlogCount),
    backlogBytes: integer(metrics.backlog_bytes ?? metrics.backlogBytes),
    oldestMessageAgeMs:
      oldestTimestamp > 0 ? Math.max(0, Math.round(Date.now() - oldestTimestamp)) : 0
  };
}

async function resolveReferenceTenant({ merchant, sourceKey, config, runtime }) {
  const result = await queryD1Batch({
    ...config,
    databaseId: runtime.controlDatabaseId,
    batch: [
      {
        sql: `WITH target AS (
                SELECT tenant_id
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1) AND status='active'
              )
              SELECT t.tenant_id,s.provider,s.source_url,p.d1_database_id,p.dispatch_namespace,
                     i.schema_version,j.import_id,j.status AS import_status,j.phase AS import_phase,
                     j.discovered_count,j.started_at,j.finished_at
                FROM target t
                JOIN supplier_sources s ON s.tenant_id=t.tenant_id AND s.source_key=?2
                JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
                JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
                JOIN tenant_import_jobs j ON j.import_id=(
                  SELECT j2.import_id FROM tenant_import_jobs j2
                   WHERE j2.tenant_id=t.tenant_id AND j2.source_key=?2 AND j2.mode='initial'
                   ORDER BY j2.created_at DESC LIMIT 1
                )
               LIMIT 1`,
        params: [merchant, sourceKey]
      }
    ]
  });
  const row = result?.[0]?.results?.[0];
  if (!row) throw new Error('ic4a_reference_tenant_missing');
  if (String(row.import_status) !== 'success' || String(row.import_phase) !== 'complete') {
    throw new Error('ic4a_reference_import_not_complete');
  }
  if (Number(row.schema_version || 0) < TENANT_DATA_PLANE_SCHEMA_VERSION) {
    throw new Error('ic4a_reference_schema_not_current');
  }
  return row;
}

async function loadReferenceDetailData({ reference, sourceKey, config, sampleSize }) {
  const limit = Math.min(MAX_SAMPLE_SIZE * CANDIDATE_MULTIPLIER, sampleSize * CANDIDATE_MULTIPLIER);
  const result = await queryD1Batch({
    ...config,
    databaseId: String(reference.d1_database_id),
    batch: [
      {
        sql: `SELECT state,COUNT(*) AS total,MIN(processed_at) AS first_terminal_at,
                    MAX(processed_at) AS last_terminal_at
               FROM supplier_album_detail_state
              WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
              GROUP BY state
              ORDER BY state`,
        params: [reference.tenant_id, sourceKey, reference.import_id]
      },
      {
        sql: `SELECT album_source_id,public_product_id,source_url,source_title,
                    source_category_id,source_category_path_json,listing_fingerprint
               FROM supplier_album_index
              WHERE tenant_id=?1 AND source_key=?2 AND status='active'
              ORDER BY album_source_id ASC
              LIMIT ?3`,
        params: [reference.tenant_id, sourceKey, limit]
      }
    ]
  });
  const states = result?.[0]?.results || [];
  const candidates = result?.[1]?.results || [];
  const categoryIds = [...new Set(candidates.flatMap(sourcePathIds))];
  let categories = [];
  if (categoryIds.length) {
    const categoryResult = await queryD1Batch({
      ...config,
      databaseId: String(reference.d1_database_id),
      batch: [
        {
          sql: `SELECT category_source_id,name,parent_source_id,depth
                  FROM supplier_category_index
                 WHERE tenant_id=?1 AND source_key=?2
                   AND category_source_id IN (SELECT CAST(value AS TEXT) FROM json_each(?3))`,
          params: [reference.tenant_id, sourceKey, JSON.stringify(categoryIds)]
        }
      ]
    });
    categories = categoryResult?.[0]?.results || [];
  }
  return { states, candidates, categories };
}

export function historicalDetailBaseline(states, discoveredCount) {
  const counts = { success: 0, skipped: 0, deferred: 0, failed: 0, processing: 0, pending: 0 };
  let firstTerminal = 0;
  let lastTerminal = 0;
  for (const row of Array.isArray(states) ? states : []) {
    const state = String(row?.state || '');
    if (Object.hasOwn(counts, state)) counts[state] += integer(row?.total);
    const first = parseSqliteTimestamp(row?.first_terminal_at);
    const last = parseSqliteTimestamp(row?.last_terminal_at);
    if (first > 0 && (!firstTerminal || first < firstTerminal)) firstTerminal = first;
    if (last > lastTerminal) lastTerminal = last;
  }
  const terminal = counts.success + counts.skipped + counts.deferred;
  const windowMs = firstTerminal && lastTerminal >= firstTerminal ? lastTerminal - firstTerminal : 0;
  const perSecond = windowMs > 0 ? Math.round((terminal / (windowMs / 1000)) * 1000) / 1000 : 0;
  return {
    discovered: integer(discoveredCount),
    terminal,
    success: counts.success,
    skipped: counts.skipped,
    deferred: counts.deferred,
    failed: counts.failed,
    detailTerminalWindowMs: windowMs,
    terminalProductsPerSecond: perSecond
  };
}

async function initializeBenchmarkDatabase({ fixture, source, config }) {
  const schema = tenantDataPlaneCurrentBatch({
    tenantId: fixture.tenantId,
    source: {
      provider: source.provider,
      sourceKey: fixture.sourceKey,
      sourceUrl: source.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
  for (const chunk of splitD1Batch(schema)) {
    await queryD1Batch({ ...config, databaseId: fixture.databaseId, batch: chunk });
  }
}

async function seedBenchmarkEvidence({ fixture, candidate, categoryPath, config }) {
  const categoryStatements = categoryPath.map((category, index) => ({
    sql: `INSERT OR IGNORE INTO supplier_category_index
            (tenant_id,source_key,category_source_id,name,parent_source_id,depth,sort_order,updated_at)
          VALUES (?1,?2,?3,?4,?5,?6,?7,CURRENT_TIMESTAMP)`,
    params: [
      fixture.tenantId,
      fixture.sourceKey,
      category.sourceId,
      category.name,
      category.parentSourceId,
      category.depth,
      index
    ]
  }));
  const claimToken = createHash('sha256')
    .update(`${fixture.importId}:${String(candidate.album_source_id)}`)
    .digest('hex')
    .slice(0, 32);
  const batch = [
    ...categoryStatements,
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,listing_fingerprint,status,updated_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'active',CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        fixture.sourceKey,
        candidate.album_source_id,
        candidate.public_product_id,
        candidate.source_url,
        candidate.source_title || '',
        candidate.source_category_id || null,
        candidate.source_category_path_json || '[]',
        candidate.listing_fingerprint
      ]
    },
    {
      sql: `INSERT INTO supplier_album_detail_state
              (tenant_id,source_key,album_source_id,import_id,state,claim_token,attempt_count,updated_at)
            VALUES (?1,?2,?3,?4,'processing',?5,1,CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        fixture.sourceKey,
        candidate.album_source_id,
        fixture.importId,
        claimToken
      ]
    }
  ];
  await queryD1Batch({ ...config, databaseId: fixture.databaseId, batch });
  return claimToken;
}

export function evaluateIc4aBaseline({ runtime, queue, historical, sample, cleanup }) {
  const checks = {
    schemaCurrent: TENANT_DATA_PLANE_SCHEMA_VERSION === 8,
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled:
      runtime?.recurringSyncEnabled === false &&
      runtime?.recurringSyncCohort === '' &&
      runtime?.recurringSyncMaxJobs === '1',
    conservativeBatchSize: runtime?.detailQueue?.batchSize === 4,
    conservativeBatchTimeout: runtime?.detailQueue?.batchTimeoutSeconds === 5,
    conservativeConcurrency: runtime?.detailQueue?.maxConcurrency === 2,
    largeCatalogEvidence:
      integer(historical?.discovered) >= 5000 && integer(historical?.terminal) >= 5000,
    historicalThroughputMeasured:
      positiveNumber(historical?.detailTerminalWindowMs) > 0 &&
      positiveNumber(historical?.terminalProductsPerSecond) > 0,
    queueMetricsMeasured:
      Number.isFinite(Number(queue?.detail?.backlogCount)) &&
      Number.isFinite(Number(queue?.detail?.oldestMessageAgeMs)),
    boundedRealSample:
      integer(sample?.requested) >= 1 &&
      integer(sample?.requested) <= MAX_SAMPLE_SIZE &&
      integer(sample?.successful) >= Math.min(4, integer(sample?.requested)),
    providerMeasured: positiveNumber(sample?.providerFetchMs?.count) >= 1,
    normalizationMeasured: positiveNumber(sample?.normalizationMs?.count) >= 1,
    d1WriteMeasured: positiveNumber(sample?.d1WriteMs?.count) >= 1,
    tempDatabaseCleaned: cleanup === true
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

export function safeIc4aEvidence({ runtime, queue, historical, sample, cleanup, evaluation }) {
  const evidence = {
    ic4aProductionBaseline: evaluation.passed ? 'passed' : 'pending',
    contractVersion: 1,
    referenceClass: 'real-large-catalog',
    detailQueue: {
      batchSize: runtime.detailQueue.batchSize,
      batchTimeoutSeconds: runtime.detailQueue.batchTimeoutSeconds,
      maxConcurrency: runtime.detailQueue.maxConcurrency,
      maxRetries: runtime.detailQueue.maxRetries,
      backlogCount: queue.detail.backlogCount,
      backlogBytes: queue.detail.backlogBytes,
      oldestMessageAgeMs: queue.detail.oldestMessageAgeMs,
      dlqBacklogCount: queue.dlq.backlogCount
    },
    historicalDetail: historical,
    sample: {
      requested: sample.requested,
      attempted: sample.attempted,
      successful: sample.successful,
      failed: sample.failed,
      providerFetchMs: sample.providerFetchMs,
      normalizationMs: sample.normalizationMs,
      d1WriteMs: sample.d1WriteMs,
      totalMeasuredMs: sample.totalMeasuredMs,
      writeStatements: sample.writeStatements,
      safeErrorCounts: sample.safeErrorCounts
    },
    currentSchemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
    initialImportEnabled: runtime.initialImportEnabled,
    recurringIntelligentSyncEnabled: runtime.recurringSyncEnabled,
    detailConcurrencyChanged: false,
    temporaryDatabaseCleaned: cleanup === true,
    privateIdentifiersExposed: false
  };
  const serialized = JSON.stringify(evidence);
  if (PRIVATE_EVIDENCE_PATTERN.test(serialized)) {
    throw new Error('ic4a_safe_evidence_private_leak');
  }
  return evidence;
}

export async function runIc4aDetailBaseline({ env = process.env } = {}) {
  const accountId = requiredEnv(env, 'CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv(env, 'CLOUDFLARE_API_TOKEN');
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  const merchant = String(env.IC4A_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const sourceKey = String(env.IC4A_SOURCE_KEY || DEFAULT_SOURCE_KEY).trim();
  const sampleSize = Math.max(
    1,
    Math.min(MAX_SAMPLE_SIZE, Number.parseInt(env.IC4A_SAMPLE_SIZE || String(DEFAULT_SAMPLE_SIZE), 10) || DEFAULT_SAMPLE_SIZE)
  );
  const runtime = await loadRepositoryConfig();
  if (!/^[a-f0-9-]{32,40}$/i.test(runtime.controlDatabaseId)) {
    throw new Error('ic4a_control_database_invalid');
  }
  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const reference = await resolveReferenceTenant({ merchant, sourceKey, config, runtime });
  const referenceData = await loadReferenceDetailData({
    reference,
    sourceKey,
    config,
    sampleSize
  });
  const historical = historicalDetailBaseline(referenceData.states, reference.discovered_count);
  const queues = await queueInventory(accountId, apiToken);
  const [detailQueueMetric, detailDlqMetric] = await Promise.all([
    realtimeQueueMetric(accountId, apiToken, queues.get(DETAIL_QUEUE)),
    realtimeQueueMetric(accountId, apiToken, queues.get(DETAIL_DLQ))
  ]);
  const queue = { detail: detailQueueMetric, dlq: detailDlqMetric };

  const provider = resolveCatalogIngestionProvider(String(reference.provider || '').trim());
  const categoryById = new Map(
    referenceData.categories.map((row) => [String(row.category_source_id), row])
  );
  const fixture = fixtureIdentity(env);
  let cleanup = false;
  const providerTimes = [];
  const normalizationTimes = [];
  const writeTimes = [];
  const totals = [];
  const statementCounts = [];
  const errorCounts = new Map();
  let attempted = 0;
  let successful = 0;

  try {
    const database = await createD1Database({
      ...config,
      databaseName: fixture.databaseName
    });
    fixture.databaseId = database.databaseId;
    await initializeBenchmarkDatabase({
      fixture,
      source: { provider: provider.key, sourceUrl: String(reference.source_url) },
      config
    });

    for (const candidate of referenceData.candidates) {
      if (successful >= sampleSize) break;
      attempted += 1;
      const categoryPath = buildCategoryPath(candidate, categoryById);
      const claimToken = await seedBenchmarkEvidence({ fixture, candidate, categoryPath, config });
      const totalStarted = performance.now();
      let detail;
      const fetchStarted = performance.now();
      try {
        detail = assertCatalogProviderDetailResult(
          await provider.fetchDetail(
            { itemUrl: String(candidate.source_url), sourceUrl: String(reference.source_url) },
            { fetchImpl: fetch }
          )
        );
      } catch (error) {
        const code = safeCode(error);
        errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
        continue;
      }
      providerTimes.push(performance.now() - fetchStarted);
      if (detail.classification?.entityType !== 'product' || !detail.name || !detail.images?.length) {
        errorCounts.set('non_product_or_incomplete', (errorCounts.get('non_product_or_incomplete') || 0) + 1);
        continue;
      }

      const normalizationStarted = performance.now();
      const write = await buildTenantProductWriteBatch({
        context: {
          importId: fixture.importId,
          tenantId: fixture.tenantId,
          sourceKey: fixture.sourceKey
        },
        evidence: {
          albumSourceId: String(candidate.album_source_id),
          publicProductId: String(candidate.public_product_id),
          sourceUrl: String(candidate.source_url),
          sourceTitle: String(candidate.source_title || ''),
          sourceCategoryId: candidate.source_category_id ? String(candidate.source_category_id) : null,
          listingFingerprint: String(candidate.listing_fingerprint || ''),
          categoryPath
        },
        detail,
        claimToken,
        provider
      });
      normalizationTimes.push(performance.now() - normalizationStarted);
      statementCounts.push(write.batch.length);

      const writeStarted = performance.now();
      await queryD1Batch({ ...config, databaseId: fixture.databaseId, batch: write.batch });
      writeTimes.push(performance.now() - writeStarted);
      totals.push(performance.now() - totalStarted);
      successful += 1;
    }
  } finally {
    if (fixture.databaseId) {
      cleanup = await deleteDatabase(accountId, apiToken, fixture.databaseId).catch(() => false);
    } else {
      cleanup = true;
    }
  }

  const sample = {
    requested: sampleSize,
    attempted,
    successful,
    failed: Math.max(0, attempted - successful),
    providerFetchMs: durationSummary(providerTimes),
    normalizationMs: durationSummary(normalizationTimes),
    d1WriteMs: durationSummary(writeTimes),
    totalMeasuredMs: durationSummary(totals),
    writeStatements: numericSummary(statementCounts),
    safeErrorCounts: [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([code, count]) => ({ code, count }))
  };
  const evaluation = evaluateIc4aBaseline({ runtime, queue, historical, sample, cleanup });
  const evidence = safeIc4aEvidence({ runtime, queue, historical, sample, cleanup, evaluation });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evaluation.passed) throw new Error('ic4a_detail_baseline_not_proven');
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runIc4aDetailBaseline().catch((error) => {
    console.error(safeCode(error));
    process.exitCode = 1;
  });
}
