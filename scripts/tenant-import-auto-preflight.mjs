import { readFile } from 'node:fs/promises';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const QUEUES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('tenant_import_preflight_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('tenant_import_preflight_token_unconfigured');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (String(wrangler.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('tenant_import_preflight_requires_automation_off');
}
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
  throw new Error('tenant_import_preflight_control_database_invalid');
}

async function cf(path) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    redirect: 'error',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      accept: 'application/json'
    }
  }).catch(() => null);
  if (!response) throw new Error('tenant_import_preflight_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error('tenant_import_preflight_cloudflare_query_failed');
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId: CONTROL_DB_ID,
    batch
  });
}

async function queueMap() {
  const result = await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const rows = Array.isArray(result) ? result : [];
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) map.set(name, id);
  }
  for (const name of QUEUES) {
    if (!map.has(name)) throw new Error('tenant_import_preflight_queue_missing');
  }
  return map;
}

async function queueBacklog(queueId) {
  const result = await cf(`/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/metrics`);
  const metrics = result?.metrics || result || {};
  return Number(metrics.backlog_count || metrics.backlogCount || 0);
}

const counts = await controlBatch([
  {
    sql: `SELECT COUNT(*) AS total
            FROM tenant_provisioning_runs r
            JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
            JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
            JOIN supplier_sources s ON s.tenant_id=r.tenant_id AND s.status='active'
            LEFT JOIN tenant_import_jobs j ON j.tenant_id=r.tenant_id
              AND j.source_key=s.source_key
              AND j.status IN ('pending','queued','scanning','details','finalizing')
           WHERE r.current_step='import'
             AND r.status IN ('running','failed','blocked')
             AND i.status='provisioning'
             AND i.schema_version >= 3
             AND p.database_status='active'
             AND p.worker_status='active'
             AND p.d1_database_id IS NOT NULL
             AND j.import_id IS NULL`,
    params: []
  },
  {
    sql: `SELECT COUNT(*) AS total
            FROM tenant_import_jobs
           WHERE mode='initial'
             AND attempt_count < 6
             AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
             AND (
               (phase='scan' AND status IN ('pending','failed')) OR
               (phase='details' AND status='failed' AND detail_enqueue_cursor < discovered_count)
             )`,
    params: []
  },
  {
    sql: `SELECT COUNT(*) AS total
            FROM tenant_import_jobs
           WHERE mode='initial'
             AND status IN ('details','finalizing')
             AND phase IN ('details','finalize')
             AND discovered_count > 0
             AND queued_detail_count = discovered_count`,
    params: []
  },
  {
    sql: `SELECT COUNT(*) AS total
            FROM tenant_import_jobs
           WHERE status IN ('pending','queued','scanning','details','finalizing')`,
    params: []
  },
  {
    sql: `SELECT COUNT(*) AS total
            FROM catalog_tenants
           WHERE slug LIKE 'queue-smoke-%' OR slug LIKE 'queue-resilience-%'`,
    params: []
  }
]);

const summary = {
  automationEnabled: false,
  undispatchedCandidates: Number(counts[0]?.results?.[0]?.total || 0),
  dueScanOrRetryJobs: Number(counts[1]?.results?.[0]?.total || 0),
  dueFinalizeJobs: Number(counts[2]?.results?.[0]?.total || 0),
  activeImportJobs: Number(counts[3]?.results?.[0]?.total || 0),
  leftoverDisposableTenants: Number(counts[4]?.results?.[0]?.total || 0),
  queueBacklogs: {}
};

const queues = await queueMap();
for (const name of QUEUES) summary.queueBacklogs[name] = await queueBacklog(queues.get(name));

const unsafe =
  summary.undispatchedCandidates !== 0 ||
  summary.dueScanOrRetryJobs !== 0 ||
  summary.dueFinalizeJobs !== 0 ||
  summary.activeImportJobs !== 0 ||
  summary.leftoverDisposableTenants !== 0 ||
  Object.values(summary.queueBacklogs).some((count) => count !== 0);

console.log(JSON.stringify({ tenantImportAutoPreflightPassed: !unsafe, ...summary }, null, 2));
if (unsafe) throw new Error('tenant_import_preflight_not_clean');
