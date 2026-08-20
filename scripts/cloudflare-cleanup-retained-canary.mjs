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

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('cleanup_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('cleanup_canary_token_unconfigured');
if (!/^t_[a-f0-9]{20}$/.test(TENANT_ID)) throw new Error('cleanup_canary_tenant_invalid');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('cleanup_canary_requires_automation_off');
}
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('cleanup_canary_control_database_invalid');
}

function platformConfig() {
  return { accountId: ACCOUNT_ID, apiToken: API_TOKEN, dispatchNamespace: DISPATCH_NAMESPACE };
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'application/json' }
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`cleanup_canary_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
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
    if (!id) throw new Error('cleanup_canary_queue_missing');
    const metricsResult = await cloudflareRequest(
      `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(id)}/metrics`
    );
    const metrics = metricsResult?.metrics || metricsResult || {};
    output[name] = Number(metrics.backlog_count || metrics.backlogCount || 0);
  }
  return output;
}

function assertQueuesClean(backlogs) {
  if (Object.values(backlogs).some((value) => Number(value || 0) !== 0)) {
    throw new Error('cleanup_canary_queue_not_empty');
  }
}

async function loadFixtureIdentity() {
  const result = await controlBatch([
    {
      sql: `SELECT t.slug, t.display_name, i.status AS instance_status,
                   p.worker_script_name, p.d1_database_id
              FROM catalog_tenants t
              JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
              JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
             WHERE t.tenant_id=?1
             LIMIT 1`,
      params: [TENANT_ID]
    },
    {
      sql: `SELECT source_key, provider, status
              FROM supplier_sources
             WHERE tenant_id=?1
             LIMIT 1`,
      params: [TENANT_ID]
    }
  ]);
  return {
    tenant: result[0]?.results?.[0] || null,
    source: result[1]?.results?.[0] || null
  };
}

function assertRetainedCanary(identity) {
  const tenant = identity.tenant;
  const source = identity.source;
  if (!tenant || !source) throw new Error('cleanup_canary_fixture_missing');
  const expectedSuffix = TENANT_ID.slice(2);
  if (!String(tenant.slug || '').startsWith('auto-canary-')) {
    throw new Error('cleanup_canary_slug_mismatch');
  }
  if (String(tenant.display_name || '') !== 'Automatic Import Canary') {
    throw new Error('cleanup_canary_display_name_mismatch');
  }
  if (String(source.source_key || '') !== 'auto-canary' || String(source.provider || '') !== 'yupoo') {
    throw new Error('cleanup_canary_source_mismatch');
  }
  if (String(tenant.worker_script_name || '') !== `ce-auto-${expectedSuffix}`) {
    throw new Error('cleanup_canary_worker_identity_mismatch');
  }
  if (!/^[a-f0-9-]{32,40}$/i.test(String(tenant.d1_database_id || ''))) {
    throw new Error('cleanup_canary_database_invalid');
  }
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

async function main() {
  const backlogsBefore = await queueBacklogs();
  assertQueuesClean(backlogsBefore);
  const identity = await loadFixtureIdentity();
  assertRetainedCanary(identity);

  const workerScriptName = String(identity.tenant.worker_script_name);
  const databaseId = String(identity.tenant.d1_database_id);

  await deleteWorker(workerScriptName);
  await deleteDatabase(databaseId);
  await controlBatch([
    { sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1', params: [TENANT_ID] }
  ]);

  const verify = await controlBatch([
    { sql: 'SELECT COUNT(*) AS total FROM catalog_tenants WHERE tenant_id=?1', params: [TENANT_ID] },
    { sql: 'SELECT COUNT(*) AS total FROM tenant_import_jobs WHERE tenant_id=?1', params: [TENANT_ID] }
  ]);
  const tenantRows = Number(verify[0]?.results?.[0]?.total || 0);
  const importRows = Number(verify[1]?.results?.[0]?.total || 0);
  const backlogsAfter = await queueBacklogs();
  assertQueuesClean(backlogsAfter);
  if (tenantRows !== 0 || importRows !== 0) throw new Error('cleanup_canary_control_state_remaining');

  console.log(
    JSON.stringify(
      {
        retainedCanaryCleanupPassed: true,
        tenantId: TENANT_ID,
        automationEnabled: false,
        controlStateRemoved: true,
        workerRemoved: true,
        databaseRemoved: true,
        queueBacklogsCleanBefore: true,
        queueBacklogsCleanAfter: true
      },
      null,
      2
    )
  );
}

await main();
