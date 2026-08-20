import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';
import { initialTenantImportId } from '../worker/tenant-import-queue.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v3.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const MAX_CANARY_PRODUCTS = Math.max(
  1,
  Math.min(10, Number.parseInt(process.env.AUTO_CANARY_MAX_PRODUCTS || '6', 10) || 6)
);
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_SOURCE_KEY = 'primary';
const POLL_MS = 5_000;
const DISCOVERY_TIMEOUT_MS = 8 * 60_000;
const COMPLETION_TIMEOUT_MS = 18 * 60_000;
const QUEUE_DRAIN_TIMEOUT_MS = 3 * 60_000;
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('auto_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('auto_canary_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('auto_canary_dispatch_namespace_invalid');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('auto_canary_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1') {
  throw new Error('auto_canary_requires_automation_on');
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
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  const suffix = createHash('sha256').update(`auto-canary:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    sourceKey: 'auto-canary',
    workerScriptName: `ce-${suffix}`,
    databaseName: `ceac-${suffix}`,
    dataPlaneKey: `auto-canary-${suffix}`,
    provisioningId: `p_${suffix}`,
    idempotencyKey: `auto-canary:${suffix}`
  };
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
    throw new Error('auto_canary_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`auto_canary_cloudflare_${code}`);
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
    if (!queues.has(name)) throw new Error('auto_canary_queue_missing');
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
  return Object.values(backlogs).every((value) => Number(value || 0) === 0);
}

async function assertQueuesClean(queues) {
  if (!backlogsClean(await queueBacklogs(queues))) throw new Error('auto_canary_queue_not_empty');
}

async function waitQueuesClean(queues, timeoutMs = QUEUE_DRAIN_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const backlogs = await queueBacklogs(queues);
    if (backlogsClean(backlogs)) return backlogs;
    await sleep(POLL_MS);
  }
  throw new Error('auto_canary_queue_did_not_drain');
}

async function defaultCatalogCount() {
  const result = await controlBatch([
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  return Number(result[0]?.results?.[0]?.total || 0);
}

async function discoverSourceScope() {
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
             LIMIT 50`,
      params: [DEFAULT_TENANT_ID, DEFAULT_SOURCE_KEY, MAX_CANARY_PRODUCTS]
    }
  ]);

  let root;
  try {
    root = new URL(String(result[0]?.results?.[0]?.source_url || '').trim());
  } catch {
    throw new Error('auto_canary_private_source_unavailable');
  }
  if (root.protocol !== 'https:' || !/\.x\.yupoo\.com$/i.test(root.hostname)) {
    throw new Error('auto_canary_private_source_invalid');
  }

  for (const row of result[1]?.results || []) {
    const categoryId = String(row.source_category_id || '').trim();
    if (!/^\d+$/.test(categoryId)) continue;
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
    if (scan?.complete && scan.items.length >= 1 && scan.items.length <= MAX_CANARY_PRODUCTS) {
      return { sourceUrl: candidate.href, expectedItems: scan.items.length };
    }
  }
  throw new Error('auto_canary_small_source_scope_not_found');
}

async function setupFixture(scope) {
  const fixture = {
    ...fixtureIdentity(),
    sourceUrl: scope.sourceUrl,
    databaseId: null,
    workerCreated: false,
    controlCreated: false,
    importId: null
  };
  activeFixture = fixture;

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
      params: [fixture.tenantId, `auto-canary-${fixture.tenantId.slice(2)}`, 'Automatic Import Canary']
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
        worker.versionId || 'auto-canary'
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
    }
  ]);
  fixture.controlCreated = true;

  const existing = await controlJob(fixture);
  if (existing) throw new Error('auto_canary_job_preexisted_scheduler');
  return fixture;
}

async function controlJob(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status, phase, attempt_count, discovered_count, detail_enqueue_cursor,
                   queued_detail_count, completed_detail_count, deferred_detail_count,
                   published_product_count, last_error_code, created_at, started_at, finished_at
              FROM tenant_import_jobs
             WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
             LIMIT 1`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

function safeJobErrorCode(value) {
  const code = String(value || '').trim();
  return /^(supplier|tenant_import|tenant_data_plane|catalog_provider|cloudflare_platform)_[a-z0-9_]+$/i.test(code)
    ? code
    : null;
}

function importFailure(row, fallbackCode) {
  const error = new Error(fallbackCode);
  error.jobErrorCode = safeJobErrorCode(row?.last_error_code);
  return error;
}

async function waitForSchedulerDiscovery(fixture) {
  const started = Date.now();
  while (Date.now() - started < DISCOVERY_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (row) {
      if (row.status === 'failed') {
        throw importFailure(row, 'auto_canary_scheduler_dispatch_failed');
      }
      return row;
    }
    await sleep(POLL_MS);
  }
  throw new Error('auto_canary_scheduler_discovery_timeout');
}

async function waitForCompletion(fixture) {
  const started = Date.now();
  while (Date.now() - started < COMPLETION_TIMEOUT_MS) {
    const row = await controlJob(fixture);
    if (!row) throw new Error('auto_canary_import_job_missing');
    if (row.status === 'success' && row.phase === 'complete') return row;
    if (row.status === 'failed') throw importFailure(row, 'auto_canary_import_failed');
    await sleep(POLL_MS);
  }
  throw new Error('auto_canary_completion_timeout');
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
    }
  ]);
  const products = Number(result[0]?.results?.[0]?.total || 0);
  const media = Number(result[1]?.results?.[0]?.total || 0);
  const leaks = Number(result[2]?.results?.[0]?.leaks || 0);
  if (products < 1 || products > MAX_CANARY_PRODUCTS) {
    throw new Error('auto_canary_product_count_invalid');
  }
  if (media < 1) throw new Error('auto_canary_catalog_incomplete');
  if (leaks !== 0) throw new Error('auto_canary_public_leak_detected');
  return { products, media, leaks };
}

async function verifyProvisioning(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT status, current_step
              FROM tenant_provisioning_runs
             WHERE provisioning_id=?1 AND tenant_id=?2
             LIMIT 1`,
      params: [fixture.provisioningId, fixture.tenantId]
    },
    {
      sql: `SELECT status, attempt_count, metadata_json
              FROM tenant_provisioning_steps
             WHERE provisioning_id=?1 AND step_key='import'
             LIMIT 1`,
      params: [fixture.provisioningId]
    }
  ]);
  const run = result[0]?.results?.[0] || null;
  const step = result[1]?.results?.[0] || null;
  if (!run || !step) throw new Error('auto_canary_provisioning_state_missing');
  if (step.status !== 'success' || Number(step.attempt_count || 0) < 1) {
    throw new Error('auto_canary_provisioning_import_incomplete');
  }
  if (!['classify', 'verify', 'publish', 'complete'].includes(String(run.current_step || ''))) {
    throw new Error('auto_canary_provisioning_did_not_advance');
  }
  return {
    runStatus: String(run.status || ''),
    currentStep: String(run.current_step || ''),
    importStepStatus: String(step.status || ''),
    importAttempts: Number(step.attempt_count || 0)
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
    ]).catch(() => null);
  }
  if (fixture.workerCreated) await deleteWorker(fixture.workerScriptName).catch(() => null);
  await deleteDatabase(fixture.databaseId).catch(() => null);
  if (activeFixture === fixture) activeFixture = null;
}

function safeErrorCode(error) {
  const message = String(error?.message || '');
  return /^auto_canary_[a-z0-9_]+$/i.test(message) ? message : 'auto_canary_failed';
}

async function main() {
  const queues = await loadQueues();
  await assertQueuesClean(queues);
  const baselineCatalogProducts = await defaultCatalogCount();
  const scope = await discoverSourceScope();
  let fixture;
  let passed = false;
  try {
    fixture = await setupFixture(scope);
    const discovery = await waitForSchedulerDiscovery(fixture);
    const finalJob = await waitForCompletion(fixture);
    const catalog = await verifyCatalog(fixture);
    const provisioning = await verifyProvisioning(fixture);
    const finalCatalogProducts = await defaultCatalogCount();
    if (finalCatalogProducts !== baselineCatalogProducts) {
      throw new Error('auto_canary_default_catalog_changed');
    }
    const finalBacklogs = await waitQueuesClean(queues);
    passed = true;
    console.log(
      JSON.stringify(
        {
          automaticTenantImportCanaryPassed: true,
          automationEnabled: true,
          manualQueueMessagesProduced: false,
          schedulerDiscovered: true,
          schedulerJobCreatedAt: discovery.created_at || null,
          schedulerAttemptCount: Number(finalJob.attempt_count || 0),
          discovered: Number(finalJob.discovered_count || 0),
          completed: Number(finalJob.completed_detail_count || 0),
          deferred: Number(finalJob.deferred_detail_count || 0),
          published: Number(finalJob.published_product_count || 0),
          catalog,
          provisioning,
          defaultCatalogCountUnchanged: true,
          queueBacklogsClean: backlogsClean(finalBacklogs),
          sourceScopeExpectedItems: scope.expectedItems
        },
        null,
        2
      )
    );
  } catch (error) {
    const code = safeErrorCode(error);
    const jobErrorCode = safeJobErrorCode(error?.jobErrorCode);
    console.error(
      JSON.stringify({
        automaticTenantImportCanaryPassed: false,
        error: code,
        jobErrorCode
      })
    );
    throw new Error(code);
  } finally {
    if (fixture) {
      if (passed) {
        await cleanupFixture(fixture);
      } else {
        const backlogs = await queueBacklogs(queues).catch(() => null);
        if (backlogs && backlogsClean(backlogs)) {
          await cleanupFixture(fixture);
        } else {
          console.error(
            JSON.stringify({
              autoCanaryFixtureRetained: true,
              tenantId: fixture.tenantId,
              reason: 'queue_evidence_not_clean'
            })
          );
        }
      }
    }
  }
}

await main();