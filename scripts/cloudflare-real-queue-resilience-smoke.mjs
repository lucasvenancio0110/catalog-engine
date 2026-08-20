import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';
import {
  assertPublicSafeImportMessage,
  buildTenantImportDetailMessage,
  buildTenantImportFinalizeMessage,
  initialTenantImportId
} from '../worker/tenant-import-queue.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v3.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_SOURCE_KEY = 'primary';
const DETAIL_QUEUE = 'catalog-engine-import-detail';
const DETAIL_DLQ = 'catalog-engine-import-detail-dlq';
const ALL_QUEUES = [
  'catalog-engine-import-scan',
  DETAIL_QUEUE,
  'catalog-engine-import-scan-dlq',
  DETAIL_DLQ
];
const POLL_MS = 10_000;
const DLQ_TIMEOUT_MS = 9 * 60_000;
const RECOVERY_TIMEOUT_MS = 4 * 60_000;

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('queue_resilience_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('queue_resilience_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('queue_resilience_dispatch_invalid');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('queue_resilience_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('queue_resilience_requires_automation_off');
}

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
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  const suffix = createHash('sha256').update(`queue-resilience:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    sourceKey: 'resilience',
    workerScriptName: `ce-${suffix}`,
    databaseName: `cer-${suffix}`,
    dataPlaneKey: `queue-resilience-${suffix}`
  };
}

async function cf(path, { method = 'GET', jsonBody = null, allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      accept: 'application/json',
      ...(jsonBody ? { 'content-type': 'application/json' } : {})
    },
    ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {})
  }).catch(() => null);
  if (!response) throw new Error('queue_resilience_cloudflare_unreachable');
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`queue_resilience_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

async function loadQueueIds() {
  const result = await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const rows = Array.isArray(result) ? result : [];
  const queues = new Map();
  for (const row of rows) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) queues.set(name, id);
  }
  for (const name of ALL_QUEUES) {
    if (!queues.has(name)) throw new Error('queue_resilience_queue_missing');
  }
  return queues;
}

async function queueBacklog(queueId) {
  const result = await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/metrics`);
  const metrics = result?.metrics || result || {};
  return Number(metrics.backlog_count || metrics.backlogCount || 0);
}

async function queueSnapshot(queues) {
  const snapshot = {};
  for (const name of ALL_QUEUES) snapshot[name] = await queueBacklog(queues.get(name));
  return snapshot;
}

function assertCleanSnapshot(snapshot) {
  if (Object.values(snapshot).some((count) => count !== 0)) {
    throw new Error('queue_resilience_queue_not_empty');
  }
}

async function waitForBacklog(queueId, minimum, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await queueBacklog(queueId);
    if (count >= minimum) return count;
    await sleep(POLL_MS);
  }
  throw new Error('queue_resilience_dlq_timeout');
}

async function waitAllQueuesClean(queues, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snapshot = await queueSnapshot(queues);
    if (Object.values(snapshot).every((count) => count === 0)) return snapshot;
    await sleep(5_000);
  }
  throw new Error('queue_resilience_queue_did_not_drain');
}

async function purge(queueId) {
  await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/purge`, {
    method: 'POST',
    jsonBody: { delete_messages_permanently: true }
  });
}

async function push(queueId, message) {
  await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/messages`, {
    method: 'POST',
    jsonBody: {
      body: assertPublicSafeImportMessage(message),
      content_type: 'json',
      delay_seconds: 0
    }
  });
}

async function discoverRecoverableAlbum() {
  const result = await controlBatch([
    {
      sql: `SELECT source_url
              FROM supplier_sources
             WHERE tenant_id=?1 AND source_key=?2 AND status IN ('active','error')
             LIMIT 1`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY]
    },
    {
      sql: `SELECT DISTINCT source_category_id
              FROM supplier_album_index
             WHERE tenant_id=?1 AND source_key=?2 AND status='active'
               AND source_category_id IS NOT NULL
             ORDER BY source_category_id ASC
             LIMIT 40`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY]
    }
  ]);

  let root;
  try {
    root = new URL(String(result[0]?.results?.[0]?.source_url || '').trim());
  } catch {
    throw new Error('queue_resilience_private_source_unavailable');
  }
  if (root.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(root.hostname)) {
    throw new Error('queue_resilience_private_source_invalid');
  }

  const ids = (result[1]?.results || [])
    .map((row) => String(row.source_category_id || '').trim())
    .filter((value) => /^\d+$/.test(value));

  for (const categoryId of ids) {
    const sourceUrl = new URL(`/categories/${categoryId}`, root.origin);
    sourceUrl.searchParams.set('isSubCate', 'true');
    let scan;
    try {
      scan = await yupooIngestionProvider.scanListingIndex(sourceUrl.href, {
        maxRootPages: 3,
        maxCategoryPages: 1,
        categoryConcurrency: 1
      });
    } catch {
      continue;
    }
    for (const item of scan?.items?.slice(0, 4) || []) {
      try {
        const detail = await yupooIngestionProvider.fetchDetail(
          { itemUrl: item.sourceUrl, sourceUrl: sourceUrl.href },
          {}
        );
        if (
          detail?.classification?.entityType === 'product' &&
          String(detail.name || '').trim() &&
          Array.isArray(detail.images) &&
          detail.images.length > 0
        ) {
          const taxonomy = scan.taxonomy || [];
          return { sourceUrl: sourceUrl.href, item, taxonomy };
        }
      } catch {
        // Try another small real album without logging its private URL.
      }
    }
  }
  throw new Error('queue_resilience_recoverable_album_not_found');
}

async function setupFixture(source) {
  const fixture = {
    ...fixtureIdentity(),
    sourceUrl: source.sourceUrl,
    item: source.item,
    taxonomy: source.taxonomy,
    databaseId: null,
    workerCreated: false,
    controlCreated: false,
    importId: null
  };

  const database = await createD1Database({ ...platformConfig(), databaseName: fixture.databaseName });
  fixture.databaseId = database.databaseId;
  await tenantBatch(
    fixture.databaseId,
    tenantDataPlaneCurrentBatch({
      tenantId: fixture.tenantId,
      source: {
        provider: 'yupoo',
        sourceKey: fixture.sourceKey,
        sourceUrl: fixture.sourceUrl,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );

  const worker = await uploadTenantCatalogWorker({
    ...platformConfig(),
    scriptName: fixture.workerScriptName,
    databaseId: fixture.databaseId,
    tenantId: fixture.tenantId
  });
  fixture.workerCreated = true;
  fixture.importId = await initialTenantImportId({ tenantId: fixture.tenantId, sourceKey: fixture.sourceKey });

  const leafId = String(fixture.item.sourceCategoryId || fixture.taxonomy.at(-1)?.id || 'resilience');
  const leaf = fixture.taxonomy.find((category) => String(category.id) === leafId) || fixture.taxonomy.at(-1) || null;
  await tenantBatch(fixture.databaseId, [
    {
      sql: `INSERT INTO supplier_category_index
              (tenant_id, source_key, category_source_id, name, parent_source_id, depth, sort_order, updated_at)
            VALUES (?1, ?2, ?3, ?4, NULL, 0, 0, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.sourceKey, leafId, String(leaf?.name || 'Resilience')]
    },
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id, source_key, album_source_id, public_product_id, source_url, source_title,
               source_category_id, source_category_path_json, cover_source_url, image_count_hint,
               listing_fingerprint, status, miss_count, first_seen_at, last_seen_at, last_changed_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        fixture.sourceKey,
        String(fixture.item.albumSourceId),
        String(fixture.item.publicProductId),
        String(fixture.item.sourceUrl),
        String(fixture.item.sourceTitle || ''),
        leafId,
        JSON.stringify([leafId]),
        fixture.item.coverSourceUrl || null,
        fixture.item.imageCountHint ?? null,
        String(fixture.item.listingFingerprint)
      ]
    }
  ]);

  await controlBatch([
    {
      sql: `INSERT INTO catalog_tenants
              (tenant_id, slug, display_name, status, created_at, updated_at)
            VALUES (?1, ?2, 'Queue Resilience Smoke', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `queue-resilience-${fixture.tenantId.slice(2)}`]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances
              (tenant_id, data_plane_key, status, schema_version, created_at, updated_at)
            VALUES (?1, ?2, 'provisioning', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.dataPlaneKey]
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
        worker.versionId || 'queue-resilience'
      ]
    },
    {
      sql: `INSERT INTO tenant_import_jobs
              (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
               discovered_count, detail_enqueue_cursor, queued_detail_count,
               next_attempt_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'initial', 'queued', 'scan', 0,
                    1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    }
  ]);
  fixture.controlCreated = true;
  return fixture;
}

async function updateImportPhase(fixture, phase, status) {
  await controlBatch([
    {
      sql: `UPDATE tenant_import_jobs
               SET phase=?2, status=?3, updated_at=CURRENT_TIMESTAMP
             WHERE import_id=?1 AND tenant_id=?4 AND source_key=?5`,
      params: [fixture.importId, phase, status, fixture.tenantId, fixture.sourceKey]
    }
  ]);
}

async function waitForDetailSuccess(fixture) {
  const started = Date.now();
  while (Date.now() - started < RECOVERY_TIMEOUT_MS) {
    const result = await tenantBatch(fixture.databaseId, [
      {
        sql: `SELECT state, attempt_count, outcome_code, last_error_code
                FROM supplier_album_detail_state
               WHERE tenant_id=?1 AND source_key=?2 AND album_source_id=?3 AND import_id=?4
               LIMIT 1`,
        params: [fixture.tenantId, fixture.sourceKey, String(fixture.item.albumSourceId), fixture.importId]
      },
      {
        sql: 'SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1',
        params: [String(fixture.item.publicProductId)]
      },
      {
        sql: 'SELECT COUNT(*) AS total FROM product_media WHERE product_id=?1',
        params: [String(fixture.item.publicProductId)]
      }
    ]);
    const state = result[0]?.results?.[0];
    const products = Number(result[1]?.results?.[0]?.total || 0);
    const media = Number(result[2]?.results?.[0]?.total || 0);
    if (state?.state === 'success' && products === 1 && media > 0) {
      return { attemptCount: Number(state.attempt_count || 0), products, media };
    }
    if (state?.state === 'deferred') throw new Error('queue_resilience_replay_deferred');
    await sleep(5_000);
  }
  throw new Error('queue_resilience_recovery_timeout');
}

async function waitFinalize(fixture) {
  const started = Date.now();
  while (Date.now() - started < RECOVERY_TIMEOUT_MS) {
    const result = await controlBatch([
      {
        sql: `SELECT status, phase, published_product_count, last_error_code
                FROM tenant_import_jobs
               WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
               LIMIT 1`,
        params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
      }
    ]);
    const row = result[0]?.results?.[0];
    if (row?.status === 'success' && row?.phase === 'complete') {
      return { published: Number(row.published_product_count || 0) };
    }
    if (row?.status === 'failed') throw new Error('queue_resilience_finalize_failed');
    await sleep(5_000);
  }
  throw new Error('queue_resilience_finalize_timeout');
}

async function deleteWorker(scriptName) {
  await cf(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabase(databaseId) {
  if (!databaseId) return;
  await cf(`/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`, {
    method: 'DELETE',
    allowNotFound: true
  });
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  if (fixture.controlCreated) {
    await controlBatch([
      { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [fixture.tenantId] }
    ]).catch(() => null);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName).catch(() => null);
  await deleteDatabase(fixture.databaseId).catch(() => null);
}

async function main() {
  const queues = await loadQueueIds();
  const initial = await queueSnapshot(queues);
  assertCleanSnapshot(initial);
  const source = await discoverRecoverableAlbum();
  let fixture;
  let failed = false;

  try {
    fixture = await setupFixture(source);
    const detailMessage = buildTenantImportDetailMessage({
      importId: fixture.importId,
      tenantId: fixture.tenantId,
      sourceKey: fixture.sourceKey,
      albumSourceId: String(fixture.item.albumSourceId)
    });

    // Deliberately leave phase='scan'. The real detail consumer must return busy,
    // Queue must retry with the production policy, and the message must eventually
    // land in the real detail DLQ instead of corrupting tenant state.
    await push(queues.get(DETAIL_QUEUE), detailMessage);
    const dlqBacklog = await waitForBacklog(queues.get(DETAIL_DLQ), 1, DLQ_TIMEOUT_MS);

    const beforeRecovery = await tenantBatch(fixture.databaseId, [
      { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
      { sql: 'SELECT COUNT(*) AS total FROM supplier_album_detail_state', params: [] }
    ]);
    if (
      Number(beforeRecovery[0]?.results?.[0]?.total || 0) !== 0 ||
      Number(beforeRecovery[1]?.results?.[0]?.total || 0) !== 0
    ) {
      throw new Error('queue_resilience_mutated_before_recovery');
    }

    // Recovery: repair durable orchestration state, replay the same opaque message
    // into the primary Queue, then finish the import through the normal finalizer.
    await updateImportPhase(fixture, 'details', 'details');
    await push(queues.get(DETAIL_QUEUE), detailMessage);
    const recovered = await waitForDetailSuccess(fixture);
    await push(
      queues.get(DETAIL_QUEUE),
      buildTenantImportFinalizeMessage({
        importId: fixture.importId,
        tenantId: fixture.tenantId,
        sourceKey: fixture.sourceKey
      })
    );
    const finalized = await waitFinalize(fixture);

    // The poison delivery is now historical evidence in the DLQ. Purge it only
    // after successful replay and durable catalog verification.
    await purge(queues.get(DETAIL_DLQ));
    const finalQueues = await waitAllQueuesClean(queues);

    console.log(
      JSON.stringify(
        {
          queueResilienceSmokePassed: true,
          automationEnabled: false,
          realRetryToDlq: true,
          dlqBacklogObserved: dlqBacklog,
          noMutationBeforeRecovery: true,
          replayRecovered: true,
          recovered,
          finalized,
          finalQueueBacklogs: finalQueues
        },
        null,
        2
      )
    );
  } catch (error) {
    failed = true;
    const message = String(error?.message || '');
    const safeCode = /^queue_resilience_[a-z0-9_]+$/i.test(message)
      ? message
      : 'queue_resilience_failed';
    console.error(JSON.stringify({ queueResilienceSmokePassed: false, error: safeCode }));
    throw new Error(safeCode);
  } finally {
    if (failed) {
      // This workflow refuses to start unless all four queues were empty, so any
      // messages present here belong to this disposable smoke run.
      for (const name of ALL_QUEUES) await purge(queues.get(name)).catch(() => null);
    }
    await cleanupFixture(fixture);
  }
}

await main();
