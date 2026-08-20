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
  buildTenantImportFinalizeMessage,
  buildTenantImportScanMessage,
  initialTenantImportId
} from '../worker/tenant-import-queue.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v3.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const MAX_SMOKE_PRODUCTS = Math.max(
  1,
  Math.min(12, Number.parseInt(process.env.QUEUE_SMOKE_MAX_PRODUCTS || '8', 10) || 8)
);
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_SOURCE_KEY = 'primary';
const POLL_MS = 5_000;
const SCAN_TIMEOUT_MS = 4 * 60_000;
const DETAIL_TIMEOUT_MS = 12 * 60_000;
const FINALIZE_TIMEOUT_MS = 3 * 60_000;
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('queue_smoke_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('queue_smoke_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('queue_smoke_dispatch_namespace_invalid');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('queue_smoke_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('queue_smoke_requires_automation_off');
}

const activeFixtures = new Set();

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

function fixtureIdentity(label) {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${label}`;
  const suffix = createHash('sha256').update(`queue-smoke:${seed}`).digest('hex').slice(0, 20);
  return {
    label,
    tenantId: `t_${suffix}`,
    sourceKey: `smoke-${label}`.slice(0, 40),
    workerScriptName: `ce-${suffix}`,
    databaseName: `ceq-${suffix}`,
    dataPlaneKey: `queue-smoke-${suffix}`
  };
}

async function cloudflareRequest(path, { method = 'GET', jsonBody = null, allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API_ORIGIN), {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        accept: 'application/json',
        ...(jsonBody ? { 'content-type': 'application/json' } : {})
      },
      ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {})
    });
  } catch {
    throw new Error('queue_smoke_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`queue_smoke_cloudflare_${code}`);
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
    if (!queues.has(name)) throw new Error('queue_smoke_queue_missing');
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

async function assertQueuesClean(queues) {
  for (const name of QUEUE_NAMES) {
    if ((await queueBacklog(queues.get(name))) !== 0) throw new Error('queue_smoke_queue_not_empty');
  }
}

async function waitQueuesClean(queues, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let dirty = false;
    for (const name of QUEUE_NAMES) {
      if ((await queueBacklog(queues.get(name))) !== 0) dirty = true;
    }
    if (!dirty) return;
    await sleep(POLL_MS);
  }
  throw new Error('queue_smoke_queue_did_not_drain');
}

async function purgeQueues(queues) {
  for (const name of QUEUE_NAMES) {
    await cloudflareRequest(
      `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queues.get(name))}/purge`,
      { method: 'POST', jsonBody: { delete_messages_permanently: true } }
    ).catch(() => null);
  }
}

async function pushMessage(queueId, message) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      jsonBody: {
        body: assertPublicSafeImportMessage(message),
        content_type: 'json',
        delay_seconds: 0
      }
    }
  );
}

async function discoverSourceScopes() {
  const result = await controlBatch([
    {
      sql: `SELECT source_url
              FROM supplier_sources
             WHERE tenant_id=?1 AND source_key=?2 AND status IN ('active','error')
             LIMIT 1`,
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
             LIMIT 40`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY, MAX_SMOKE_PRODUCTS]
    }
  ]);

  let root;
  try {
    root = new URL(String(result[0]?.results?.[0]?.source_url || '').trim());
  } catch {
    throw new Error('queue_smoke_private_source_unavailable');
  }
  if (root.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(root.hostname)) {
    throw new Error('queue_smoke_private_source_invalid');
  }

  const categoryIds = (result[1]?.results || [])
    .map((row) => String(row.source_category_id || '').trim())
    .filter((value) => /^\d+$/.test(value));
  const scopes = [];
  const occupied = new Set();

  for (const categoryId of categoryIds) {
    const candidate = new URL(`/categories/${categoryId}`, root.origin);
    candidate.searchParams.set('isSubCate', 'true');
    let scan;
    try {
      scan = await yupooIngestionProvider.scanListingIndex(candidate.href, {
        maxRootPages: 4,
        maxCategoryPages: 1,
        categoryConcurrency: 1
      });
    } catch {
      continue;
    }
    if (!scan?.complete || scan.items.length < 1 || scan.items.length > MAX_SMOKE_PRODUCTS) continue;
    const ids = scan.items.map((item) => String(item.albumSourceId));
    if (ids.some((id) => occupied.has(id))) continue;
    scopes.push({ sourceUrl: candidate.href, expectedItems: scan.items.length });
    for (const id of ids) occupied.add(id);
    if (scopes.length === 2) break;
  }

  if (scopes.length !== 2) throw new Error('queue_smoke_small_source_scope_not_found');
  return scopes;
}

async function setupFixture(label, scope) {
  const fixture = {
    ...fixtureIdentity(label),
    sourceUrl: scope.sourceUrl,
    databaseId: null,
    workerCreated: false,
    controlCreated: false,
    importId: null
  };
  activeFixtures.add(fixture);

  const database = await createD1Database({
    ...platformConfig(),
    databaseName: fixture.databaseName
  });
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
  fixture.importId = await initialTenantImportId({
    tenantId: fixture.tenantId,
    sourceKey: fixture.sourceKey
  });

  await controlBatch([
    {
      sql: `INSERT INTO catalog_tenants
              (tenant_id, slug, display_name, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `queue-smoke-${fixture.tenantId.slice(2)}`, `Queue Smoke ${label}`]
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
        worker.versionId || 'queue-smoke'
      ]
    },
    {
      sql: `INSERT INTO tenant_import_jobs
              (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
               next_attempt_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'initial', 'queued', 'scan', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    }
  ]);
  fixture.controlCreated = true;
  return fixture;
}

async function controlJob(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status, phase, discovered_count, detail_enqueue_cursor, queued_detail_count,
                   published_product_count, last_error_code
              FROM tenant_import_jobs
             WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
             LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function waitScan(fixture) {
  const started = Date.now();
  while (Date.now() - started < SCAN_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (!row) throw new Error('queue_smoke_import_job_missing');
    if (row.status === 'failed') {
      const code = String(row.last_error_code || 'queue_smoke_scan_failed');
      if (/^(tenant|supplier|catalog_provider)_[a-z0-9_]+$/i.test(code)) {
        throw new Error(`queue_smoke_scan_${code}`);
      }
      throw new Error('queue_smoke_scan_failed');
    }
    const discovered = Number(row.discovered_count || 0);
    const queued = Number(row.queued_detail_count || 0);
    const cursor = Number(row.detail_enqueue_cursor || 0);
    if (discovered > 0 && queued === discovered && cursor === discovered) {
      if (discovered > MAX_SMOKE_PRODUCTS) throw new Error('queue_smoke_scope_expanded');
      return discovered;
    }
    await sleep(POLL_MS);
  }
  throw new Error('queue_smoke_scan_timeout');
}

async function waitDetails(fixture, discovered) {
  const started = Date.now();
  while (Date.now() - started < DETAIL_TIMEOUT_MS) {
    const result = await tenantBatch(fixture.databaseId, [
      {
        sql: `SELECT state, COUNT(*) AS total
                FROM supplier_album_detail_state
               WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
               GROUP BY state`,
        params: [fixture.tenantId, fixture.sourceKey, fixture.importId]
      }
    ]);
    const counts = {};
    for (const row of result[0]?.results || []) counts[row.state] = Number(row.total || 0);
    const terminal = Number(counts.success || 0) + Number(counts.skipped || 0) + Number(counts.deferred || 0);
    if (terminal === discovered) return counts;
    if (terminal > discovered) throw new Error('queue_smoke_detail_count_invalid');
    await sleep(POLL_MS);
  }
  throw new Error('queue_smoke_detail_timeout');
}

async function waitFinalize(fixture) {
  const started = Date.now();
  while (Date.now() - started < FINALIZE_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (!row) throw new Error('queue_smoke_import_job_missing');
    if (row.status === 'success' && row.phase === 'complete') return row;
    if (row.status === 'failed') throw new Error('queue_smoke_finalize_failed');
    await sleep(POLL_MS);
  }
  throw new Error('queue_smoke_finalize_timeout');
}

async function verifyCatalog(fixture) {
  const result = await tenantBatch(fixture.databaseId, [
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
    { sql: 'SELECT COUNT(*) AS total FROM media_sources', params: [] },
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
    },
    { sql: 'SELECT product_id FROM catalog_products ORDER BY product_id LIMIT 1', params: [] },
    { sql: 'SELECT media_id FROM media_sources ORDER BY media_id LIMIT 1', params: [] }
  ]);
  const products = Number(result[0]?.results?.[0]?.total || 0);
  const media = Number(result[1]?.results?.[0]?.total || 0);
  const leaks = Number(result[2]?.results?.[0]?.leaks || 0);
  const productId = String(result[3]?.results?.[0]?.product_id || '');
  const mediaId = String(result[4]?.results?.[0]?.media_id || '');
  if (products < 1 || products > MAX_SMOKE_PRODUCTS) throw new Error('queue_smoke_product_count_invalid');
  if (media < 1 || !productId || !mediaId) throw new Error('queue_smoke_catalog_incomplete');
  if (leaks !== 0) throw new Error('queue_smoke_public_leak_detected');
  return { products, media, productId, mediaId };
}

async function executeFixture(fixture, queues) {
  const scan = await buildTenantImportScanMessage({ tenantId: fixture.tenantId, sourceKey: fixture.sourceKey });
  if (scan.importId !== fixture.importId) throw new Error('queue_smoke_import_identity_mismatch');
  await pushMessage(queues.get('catalog-engine-import-scan'), scan);
  const discovered = await waitScan(fixture);
  const details = await waitDetails(fixture, discovered);
  await pushMessage(
    queues.get('catalog-engine-import-detail'),
    buildTenantImportFinalizeMessage({
      importId: fixture.importId,
      tenantId: fixture.tenantId,
      sourceKey: fixture.sourceKey
    })
  );
  const finalJob = await waitFinalize(fixture);
  return {
    discovered,
    details,
    finalJob,
    catalog: await verifyCatalog(fixture)
  };
}

async function proveCrossTenantIsolation(a, aResult, b, bResult) {
  if (aResult.productId === bResult.productId || aResult.mediaId === bResult.mediaId) {
    throw new Error('queue_smoke_sources_not_disjoint');
  }
  const [aCross, bCross] = await Promise.all([
    tenantBatch(a.databaseId, [
      { sql: 'SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1', params: [bResult.productId] },
      { sql: 'SELECT COUNT(*) AS total FROM media_sources WHERE media_id=?1', params: [bResult.mediaId] }
    ]),
    tenantBatch(b.databaseId, [
      { sql: 'SELECT COUNT(*) AS total FROM catalog_products WHERE product_id=?1', params: [aResult.productId] },
      { sql: 'SELECT COUNT(*) AS total FROM media_sources WHERE media_id=?1', params: [aResult.mediaId] }
    ])
  ]);
  const values = [
    aCross[0]?.results?.[0]?.total,
    aCross[1]?.results?.[0]?.total,
    bCross[0]?.results?.[0]?.total,
    bCross[1]?.results?.[0]?.total
  ].map((value) => Number(value || 0));
  if (values.some((value) => value !== 0)) throw new Error('queue_smoke_cross_tenant_leak');
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
    ]).catch(() => null);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName).catch(() => null);
  await deleteDatabase(fixture.databaseId).catch(() => null);
  activeFixtures.delete(fixture);
}

async function cleanupAllFixtures() {
  for (const fixture of [...activeFixtures]) await cleanupFixture(fixture);
}

function resultSummary(result) {
  return {
    discovered: result.discovered,
    products: result.catalog.products,
    media: result.catalog.media,
    deferred: Number(result.details.deferred || 0)
  };
}

async function main() {
  const queues = await loadQueues();
  await assertQueuesClean(queues);
  const scopes = await discoverSourceScopes();
  let failed = false;
  try {
    const one = await setupFixture('one', scopes[0]);
    const oneResult = await executeFixture(one, queues);
    await waitQueuesClean(queues);
    const single = resultSummary(oneResult);
    await cleanupFixture(one);

    const twoA = await setupFixture('two-a', scopes[0]);
    const twoB = await setupFixture('two-b', scopes[1]);
    const [twoAResult, twoBResult] = await Promise.all([
      executeFixture(twoA, queues),
      executeFixture(twoB, queues)
    ]);
    await proveCrossTenantIsolation(twoA, twoAResult.catalog, twoB, twoBResult.catalog);
    await waitQueuesClean(queues);
    const pair = {
      tenantA: resultSummary(twoAResult),
      tenantB: resultSummary(twoBResult),
      crossTenantIsolation: true
    };
    await cleanupFixture(twoA);
    await cleanupFixture(twoB);

    console.log(
      JSON.stringify(
        {
          queueImportSmokePassed: true,
          automationEnabled: false,
          sourceScopes: scopes.map((scope) => ({ expectedItems: scope.expectedItems })),
          single,
          pair
        },
        null,
        2
      )
    );
  } catch (error) {
    failed = true;
    const message = String(error?.message || '');
    const safeCode = /^queue_smoke_[a-z0-9_]+$/i.test(message) ? message : 'queue_smoke_failed';
    console.error(JSON.stringify({ queueImportSmokePassed: false, error: safeCode }));
    throw new Error(safeCode);
  } finally {
    if (failed) await purgeQueues(queues);
    await cleanupAllFixtures();
  }
}

await main();
