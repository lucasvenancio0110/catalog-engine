import { readFile } from 'node:fs/promises';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const TENANT_ID = String(process.env.RETAINED_CANARY_TENANT_ID || '').trim();
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('retained_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('retained_canary_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('retained_canary_dispatch_namespace_invalid');
}
if (!/^t_[a-f0-9]{20}$/.test(TENANT_ID)) throw new Error('retained_canary_tenant_invalid');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('retained_canary_control_database_invalid');
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function cloudflareRequest(path) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method: 'GET',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      accept: 'application/json'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`retained_canary_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({
    ...platformConfig(),
    databaseId: CONTROL_DB_ID,
    batch
  });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({
    ...platformConfig(),
    databaseId,
    batch
  });
}

async function queueBacklogs() {
  const result = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const rows = Array.isArray(result) ? result : [];
  const queues = new Map();
  for (const row of rows) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) queues.set(name, id);
  }

  const output = {};
  for (const name of QUEUE_NAMES) {
    const id = queues.get(name);
    if (!id) {
      output[name] = { missing: true };
      continue;
    }
    const metricsResult = await cloudflareRequest(
      `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(id)}/metrics`
    );
    const metrics = metricsResult?.metrics || metricsResult || {};
    output[name] = {
      backlog: Number(metrics.backlog_count || metrics.backlogCount || 0)
    };
  }
  return output;
}

function rows(result, index) {
  return result[index]?.results || [];
}

function safeOperationalCode(value) {
  const code = String(value || '').trim();
  return /^[a-z][a-z0-9_]{2,95}$/i.test(code) ? code : null;
}

function safeImportJob(row) {
  return {
    importId: String(row.import_id || ''),
    mode: String(row.mode || ''),
    status: String(row.status || ''),
    phase: String(row.phase || ''),
    attemptCount: Number(row.attempt_count || 0),
    discoveredCount: Number(row.discovered_count || 0),
    queuedDetailCount: Number(row.queued_detail_count || 0),
    completedDetailCount: Number(row.completed_detail_count || 0),
    failedDetailCount: Number(row.failed_detail_count || 0),
    deferredDetailCount: Number(row.deferred_detail_count || 0),
    publishedProductCount: Number(row.published_product_count || 0),
    lastErrorCode: safeOperationalCode(row.last_error_code),
    nextAttemptAt: row.next_attempt_at || null,
    scanLeaseUntil: row.scan_lease_until || null,
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    updatedAt: row.updated_at || null
  };
}

function safeProvisioningRun(row) {
  return {
    provisioningId: String(row.provisioning_id || ''),
    status: String(row.status || ''),
    currentStep: String(row.current_step || ''),
    lastErrorCode: safeOperationalCode(row.last_error),
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function safeProvisioningStep(row) {
  return {
    provisioningId: String(row.provisioning_id || ''),
    stepKey: String(row.step_key || ''),
    status: String(row.status || ''),
    attemptCount: Number(row.attempt_count || 0),
    lastErrorCode: safeOperationalCode(row.last_error),
    updatedAt: row.updated_at || null
  };
}

function safeCeiJob(row) {
  return {
    status: String(row.status || ''),
    classifierVersion: Number(row.classifier_version || 0),
    classifierKey: row.classifier_key ? String(row.classifier_key) : null,
    productCount: Number(row.product_count || 0),
    findingCount: Number(row.finding_count || 0),
    lastErrorCode: safeOperationalCode(row.last_error_code),
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    updatedAt: row.updated_at || null
  };
}

async function main() {
  const control = await controlBatch([
    {
      sql: `SELECT import_id, mode, status, phase, attempt_count, discovered_count,
                   queued_detail_count, completed_detail_count, failed_detail_count,
                   deferred_detail_count, published_product_count, last_error_code,
                   next_attempt_at, scan_lease_until, created_at, started_at, finished_at, updated_at
              FROM tenant_import_jobs
             WHERE tenant_id=?1
             ORDER BY created_at DESC
             LIMIT 5`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT provisioning_id, status, current_step, last_error,
                   started_at, finished_at, created_at, updated_at
              FROM tenant_provisioning_runs
             WHERE tenant_id=?1
             ORDER BY created_at DESC
             LIMIT 5`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT s.provisioning_id, s.step_key, s.status, s.attempt_count,
                   s.last_error, s.updated_at
              FROM tenant_provisioning_steps s
              JOIN tenant_provisioning_runs r ON r.provisioning_id=s.provisioning_id
             WHERE r.tenant_id=?1
             ORDER BY r.created_at DESC, s.step_key ASC`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT provider, dispatch_namespace, worker_status, database_status,
                   d1_database_id, last_checked_at, updated_at
              FROM tenant_data_plane_provider_state
             WHERE tenant_id=?1
             LIMIT 1`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT source_key, provider, status, sync_strategy,
                   last_success_at, last_error, updated_at
              FROM supplier_sources
             WHERE tenant_id=?1
             ORDER BY source_key ASC`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT status, schema_version, updated_at
              FROM tenant_catalog_instances
             WHERE tenant_id=?1
             LIMIT 1`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT status, classifier_version, classifier_key, product_count,
                   last_error_code, created_at, started_at, finished_at, updated_at
              FROM tenant_classification_jobs
             WHERE tenant_id=?1
             ORDER BY created_at DESC
             LIMIT 5`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT status, classifier_version, product_count, finding_count,
                   last_error_code, created_at, started_at, finished_at, updated_at
              FROM tenant_verification_jobs
             WHERE tenant_id=?1
             ORDER BY created_at DESC
             LIMIT 5`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT mode, status, phase, COUNT(*) AS total
              FROM tenant_import_jobs
             GROUP BY mode, status, phase
             ORDER BY mode, status, phase`,
      params: []
    }
  ]);

  const provider = rows(control, 3)[0] || null;
  const databaseId = String(provider?.d1_database_id || '').trim();
  let tenantState = null;

  if (/^[a-f0-9-]{32,40}$/i.test(databaseId)) {
    const tenant = await tenantBatch(databaseId, [
      {
        sql: `SELECT state, COALESCE(outcome_code,'') AS outcome_code,
                     COALESCE(last_error_code,'') AS last_error_code, COUNT(*) AS total
                FROM supplier_album_detail_state
               WHERE tenant_id=?1
               GROUP BY state, outcome_code, last_error_code
               ORDER BY state, outcome_code, last_error_code`,
        params: [TENANT_ID]
      },
      {
        sql: `SELECT COALESCE(detail_last_error,'') AS detail_last_error,
                     COUNT(*) AS total,
                     MAX(detail_retry_count) AS max_retry_count
                FROM supplier_album_index
               WHERE tenant_id=?1
               GROUP BY detail_last_error
               ORDER BY total DESC`,
        params: [TENANT_ID]
      },
      {
        sql: `SELECT COUNT(*) AS total FROM supplier_album_index WHERE tenant_id=?1`,
        params: [TENANT_ID]
      },
      { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
      { sql: 'SELECT COUNT(*) AS total FROM media_sources', params: [] },
      {
        sql: `SELECT tenant_id, schema_version
                FROM data_plane_identity
               WHERE tenant_id=?1
               LIMIT 1`,
        params: [TENANT_ID]
      },
      { sql: 'PRAGMA foreign_key_check', params: [] },
      { sql: 'SELECT COUNT(*) AS total FROM catalog_product_classification_state', params: [] },
      { sql: 'SELECT COUNT(*) AS total FROM catalog_product_intelligence_state', params: [] },
      { sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_runs', params: [] }
    ]);
    tenantState = {
      detailStates: rows(tenant, 0).map((row) => ({
        state: String(row.state || ''),
        outcomeCode: safeOperationalCode(row.outcome_code),
        lastErrorCode: safeOperationalCode(row.last_error_code),
        total: Number(row.total || 0)
      })),
      albumRetryErrors: rows(tenant, 1).map((row) => ({
        detailLastErrorCode: safeOperationalCode(row.detail_last_error),
        total: Number(row.total || 0),
        maxRetryCount: Number(row.max_retry_count || 0)
      })),
      indexedAlbums: Number(rows(tenant, 2)[0]?.total || 0),
      catalogProducts: Number(rows(tenant, 3)[0]?.total || 0),
      mediaSources: Number(rows(tenant, 4)[0]?.total || 0),
      identity: rows(tenant, 5)[0] || null,
      foreignKeyFindings: rows(tenant, 6).length,
      classificationStates: Number(rows(tenant, 7)[0]?.total || 0),
      intelligenceStates: Number(rows(tenant, 8)[0]?.total || 0),
      stagedSyncRuns: Number(rows(tenant, 9)[0]?.total || 0)
    };
  }

  console.log(
    JSON.stringify(
      {
        readOnly: true,
        retainedCanaryDiagnostic: true,
        tenantId: TENANT_ID,
        importJobs: rows(control, 0).map(safeImportJob),
        provisioningRuns: rows(control, 1).map(safeProvisioningRun),
        provisioningSteps: rows(control, 2).map(safeProvisioningStep),
        dataPlane: provider
          ? {
              provider: provider.provider,
              dispatchNamespace: provider.dispatch_namespace,
              workerStatus: provider.worker_status,
              databaseStatus: provider.database_status,
              lastCheckedAt: provider.last_checked_at,
              updatedAt: provider.updated_at
            }
          : null,
        sources: rows(control, 4).map((row) => ({
          sourceKey: String(row.source_key || ''),
          provider: String(row.provider || ''),
          status: String(row.status || ''),
          syncStrategy: String(row.sync_strategy || ''),
          lastSuccessAt: row.last_success_at || null,
          lastErrorCode: safeOperationalCode(row.last_error),
          updatedAt: row.updated_at || null
        })),
        catalogInstance: rows(control, 5)[0] || null,
        classificationJobs: rows(control, 6).map(safeCeiJob),
        verificationJobs: rows(control, 7).map(safeCeiJob),
        importJobAggregate: rows(control, 8).map((row) => ({
          mode: String(row.mode || ''),
          status: String(row.status || ''),
          phase: String(row.phase || ''),
          total: Number(row.total || 0)
        })),
        tenantState,
        queueBacklogs: await queueBacklogs()
      },
      null,
      2
    )
  );
}

await main();
