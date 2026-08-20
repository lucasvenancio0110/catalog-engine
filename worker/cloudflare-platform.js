import {
  TENANT_CATALOG_RUNTIME_VERSION,
  tenantCatalogWorkerSource
} from './tenant-catalog-runtime.js';
import { queryTenantDataPlaneBatch } from './ingestion/tenant-data-plane.js';
import {
  tenantBootstrapWorkerSourceWithDataPlaneCommand,
  wrapTenantWorkerSourceWithDataPlaneCommand
} from './tenant-data-plane-command.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const DATABASE_ID_PATTERN = /^[a-f0-9-]{32,40}$/i;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const REQUEST_TIMEOUT_MS = 20_000;

export class CloudflarePlatformError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'CloudflarePlatformError';
    this.code = code;
    this.status = status;
  }
}

function platformConfig({ accountId, apiToken, dispatchNamespace }) {
  const normalizedAccountId = String(accountId || '').trim();
  const normalizedToken = String(apiToken || '').trim();
  const normalizedNamespace = String(dispatchNamespace || '').trim();
  if (
    !ACCOUNT_ID_PATTERN.test(normalizedAccountId) ||
    normalizedToken.length < 20 ||
    !RESOURCE_NAME_PATTERN.test(normalizedNamespace)
  ) {
    throw new CloudflarePlatformError('cloudflare_platform_unconfigured', 503);
  }
  return {
    accountId: normalizedAccountId,
    apiToken: normalizedToken,
    dispatchNamespace: normalizedNamespace
  };
}

function safeResourceName(value, code) {
  const normalized = String(value || '').trim();
  if (!RESOURCE_NAME_PATTERN.test(normalized)) {
    throw new CloudflarePlatformError(code, 500);
  }
  return normalized;
}

function safeDatabaseId(value) {
  const normalized = String(value || '').trim();
  if (!DATABASE_ID_PATTERN.test(normalized)) {
    throw new CloudflarePlatformError('invalid_tenant_database_id', 500);
  }
  return normalized;
}

function safeTenantId(value) {
  const tenantId = String(value || '').trim();
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new CloudflarePlatformError('invalid_tenant_id', 500);
  }
  return tenantId;
}

async function apiRequest(
  path,
  {
    method = 'GET',
    config,
    fetchImpl = fetch,
    jsonBody = null,
    formBody = null,
    allowNotFound = false
  } = {}
) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new CloudflarePlatformError('cloudflare_platform_invalid_request', 500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url.href, {
      method,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        accept: 'application/json',
        ...(jsonBody ? { 'content-type': 'application/json' } : {})
      },
      ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {}),
      ...(formBody ? { body: formBody } : {})
    });
  } catch {
    clearTimeout(timer);
    throw new CloudflarePlatformError('cloudflare_platform_unreachable', 503);
  }
  clearTimeout(timer);

  if (allowNotFound && response.status === 404) return null;

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CloudflarePlatformError('cloudflare_platform_invalid_response');
  }
  if (!response.ok || payload?.success !== true) {
    const providerCode = payload?.errors?.[0]?.code;
    const safeCode = Number.isFinite(Number(providerCode)) ? String(providerCode) : 'unknown';
    const status = response.status === 429 ? 503 : response.status >= 400 && response.status < 500 ? 422 : 502;
    throw new CloudflarePlatformError(`cloudflare_platform_${safeCode}`, status);
  }
  return payload.result ?? null;
}

export async function assertDispatchNamespace(
  { accountId, apiToken, dispatchNamespace },
  { fetchImpl = fetch } = {}
) {
  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const result = await apiRequest(
    `/client/v4/accounts/${config.accountId}/workers/dispatch/namespaces/${encodeURIComponent(config.dispatchNamespace)}`,
    { config, fetchImpl, allowNotFound: true }
  );
  if (!result) throw new CloudflarePlatformError('dispatch_namespace_not_found', 503);
  return {
    namespace: config.dispatchNamespace,
    namespaceId: result.namespace_id || null
  };
}

export async function findD1DatabaseByName(
  { accountId, apiToken, dispatchNamespace, databaseName },
  { fetchImpl = fetch } = {}
) {
  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const name = safeResourceName(databaseName, 'invalid_tenant_database_name');
  const url = new URL(`/client/v4/accounts/${config.accountId}/d1/database`, API_ORIGIN);
  url.searchParams.set('name', name);
  url.searchParams.set('per_page', '50');
  const result = await apiRequest(`${url.pathname}${url.search}`, { config, fetchImpl });
  const rows = Array.isArray(result) ? result : [];
  const match = rows.find((row) => row?.name === name);
  if (!match) return null;
  if (!match.uuid) throw new CloudflarePlatformError('cloudflare_platform_invalid_d1_response');
  return { databaseId: String(match.uuid), databaseName: name };
}

export async function createD1Database(
  { accountId, apiToken, dispatchNamespace, databaseName },
  { fetchImpl = fetch } = {}
) {
  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const name = safeResourceName(databaseName, 'invalid_tenant_database_name');
  const result = await apiRequest(`/client/v4/accounts/${config.accountId}/d1/database`, {
    method: 'POST',
    config,
    fetchImpl,
    jsonBody: { name, read_replication: { mode: 'disabled' } }
  });
  if (!result?.uuid) throw new CloudflarePlatformError('cloudflare_platform_invalid_d1_response');
  return { databaseId: String(result.uuid), databaseName: name };
}

export async function ensureD1Database(input, options = {}) {
  const existing = await findD1DatabaseByName(input, options);
  if (existing) return { ...existing, created: false };
  const created = await createD1Database(input, options);
  return { ...created, created: true };
}

function normalizeD1Batch(batch) {
  if (!Array.isArray(batch) || batch.length < 1 || batch.length > 100) {
    throw new CloudflarePlatformError('invalid_tenant_d1_batch', 500);
  }
  return batch.map((query) => {
    const sql = String(query?.sql || '').trim();
    if (!sql || sql.length > 100_000) {
      throw new CloudflarePlatformError('invalid_tenant_d1_query', 500);
    }
    const params = Array.isArray(query?.params)
      ? query.params.map((value) => (value === null || value === undefined ? null : String(value)))
      : [];
    if (params.length > 100) throw new CloudflarePlatformError('invalid_tenant_d1_query', 500);
    return { sql, params };
  });
}

function tenantIdFromBatch(batch) {
  const tenantIds = new Set();
  for (const query of batch) {
    for (const value of query.params || []) {
      const candidate = String(value || '');
      if (TENANT_ID_PATTERN.test(candidate)) tenantIds.add(candidate);
    }
  }
  if (tenantIds.size !== 1) {
    throw new CloudflarePlatformError('tenant_data_plane_tenant_unresolved', 500);
  }
  return [...tenantIds][0];
}

export async function queryD1Batch(
  { accountId, apiToken, dispatchNamespace, databaseId, batch, tenantDispatch },
  { fetchImpl = fetch } = {}
) {
  const normalizedBatch = normalizeD1Batch(batch);

  if (tenantDispatch && typeof tenantDispatch.get === 'function') {
    const tenantId = tenantIdFromBatch(normalizedBatch);
    return queryTenantDataPlaneBatch(
      {
        tenantId,
        dataPlane: { workerScriptName: `ce-${tenantId.slice(2)}` }
      },
      { TENANT_DISPATCH: tenantDispatch },
      normalizedBatch
    );
  }

  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const database = safeDatabaseId(databaseId);
  const result = await apiRequest(
    `/client/v4/accounts/${config.accountId}/d1/database/${encodeURIComponent(database)}/query`,
    {
      method: 'POST',
      config,
      fetchImpl,
      jsonBody: { batch: normalizedBatch }
    }
  );
  const rows = Array.isArray(result) ? result : [];
  if (rows.length !== normalizedBatch.length || rows.some((row) => row?.success === false)) {
    throw new CloudflarePlatformError('tenant_d1_query_failed', 502);
  }
  return rows;
}

export function tenantBootstrapWorkerSource() {
  return tenantBootstrapWorkerSourceWithDataPlaneCommand();
}

export function namespacedTenantCatalogWorkerSource() {
  // Workers for Platforms disables caches.default for namespaced User Workers in
  // untrusted mode. Shadow the global Cache API so the shared runtime naturally
  // takes its no-cache path while preserving the stronger namespace isolation.
  const source = wrapTenantWorkerSourceWithDataPlaneCommand(tenantCatalogWorkerSource());
  return `const caches = undefined;\n${source}`;
}

async function uploadTenantWorker(
  {
    accountId,
    apiToken,
    dispatchNamespace,
    scriptName,
    databaseId,
    tenantId,
    source,
    runtimeVersion = 0,
    compatibilityDate = '2026-08-17'
  },
  { fetchImpl = fetch } = {}
) {
  const config = platformConfig({ accountId, apiToken, dispatchNamespace });
  const script = safeResourceName(scriptName, 'invalid_tenant_worker_name');
  const database = safeDatabaseId(databaseId);
  const tenant = safeTenantId(tenantId);
  const workerSource = String(source || '');
  if (!workerSource || workerSource.length > 1_500_000) {
    throw new CloudflarePlatformError('invalid_tenant_worker_source', 500);
  }

  const metadata = {
    main_module: 'worker.js',
    compatibility_date: compatibilityDate,
    bindings: [
      { type: 'd1', name: 'CATALOG_DB', database_id: database },
      { type: 'plain_text', name: 'TENANT_ID', text: tenant },
      { type: 'plain_text', name: 'TENANT_RUNTIME_VERSION', text: String(runtimeVersion) }
    ]
  };
  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.set('worker.js', new Blob([workerSource], { type: 'application/javascript+module' }), 'worker.js');

  const result = await apiRequest(
    `/client/v4/accounts/${config.accountId}/workers/dispatch/namespaces/${encodeURIComponent(config.dispatchNamespace)}/scripts/${encodeURIComponent(script)}`,
    { method: 'PUT', config, fetchImpl, formBody: form }
  );
  return {
    scriptName: script,
    runtimeVersion,
    startupTimeMs: Number(result?.startup_time_ms || 0),
    versionId: result?.version_id || result?.etag || null
  };
}

export async function uploadTenantBootstrapWorker(input, options = {}) {
  return uploadTenantWorker(
    {
      ...input,
      source: tenantBootstrapWorkerSource(),
      runtimeVersion: 0
    },
    options
  );
}

export async function uploadTenantCatalogWorker(input, options = {}) {
  return uploadTenantWorker(
    {
      ...input,
      source: namespacedTenantCatalogWorkerSource(),
      runtimeVersion: TENANT_CATALOG_RUNTIME_VERSION
    },
    options
  );
}
