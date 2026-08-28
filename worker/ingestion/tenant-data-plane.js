import { tenantDispatchFetcher } from '../tenant-dispatch.js';
import {
  TENANT_DATA_PLANE_COMMAND_PATH,
  TENANT_DATA_PLANE_COMMAND_VERSION,
  TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH,
  TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,
  normalizeTenantDataPlaneBatch
} from '../tenant-data-plane-command.js';

const WORKER_SCRIPT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const INTERNAL_ORIGIN = 'https://catalog-engine.internal';

export class TenantDataPlaneClientError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'TenantDataPlaneClientError';
    this.code = code;
    this.status = status;
  }
}

function dataPlaneTarget(context) {
  const tenantId = String(context?.tenantId || '').trim();
  const workerScriptName = String(context?.dataPlane?.workerScriptName || '').trim();
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new TenantDataPlaneClientError('tenant_data_plane_tenant_invalid', 500);
  }
  if (!WORKER_SCRIPT_PATTERN.test(workerScriptName)) {
    throw new TenantDataPlaneClientError('tenant_data_plane_worker_invalid', 500);
  }
  return { tenantId, workerScriptName };
}

export function tenantDataPlaneDispatchConfigured(env) {
  return Boolean(env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function');
}

export async function queryTenantDataPlaneBatch(context, env, batch) {
  if (!tenantDataPlaneDispatchConfigured(env)) {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_unbound', 503);
  }
  const target = dataPlaneTarget(context);
  let normalizedBatch;
  try {
    normalizedBatch = normalizeTenantDataPlaneBatch(batch);
  } catch (error) {
    throw new TenantDataPlaneClientError(error?.code || 'tenant_data_plane_batch_invalid', 500);
  }

  let fetcher;
  try {
    fetcher = await tenantDispatchFetcher(env, target.workerScriptName);
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_unavailable', 503);
  }

  const request = new Request(new URL(TENANT_DATA_PLANE_COMMAND_PATH, INTERNAL_ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-catalog-tenant-id': target.tenantId
    },
    body: JSON.stringify({
      version: TENANT_DATA_PLANE_COMMAND_VERSION,
      tenantId: target.tenantId,
      batch: normalizedBatch
    })
  });

  let response;
  try {
    response = await fetcher.fetch(request);
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_failed', 503);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_response_invalid');
  }

  if (
    !response.ok ||
    payload?.ok !== true ||
    Number(payload?.version) !== TENANT_DATA_PLANE_COMMAND_VERSION
  ) {
    const code = /^tenant_data_plane_[a-z0-9_]+$/.test(String(payload?.error || ''))
      ? String(payload.error)
      : 'tenant_data_plane_query_failed';
    throw new TenantDataPlaneClientError(code, response.status || 502);
  }
  if (!Array.isArray(payload.results) || payload.results.length !== normalizedBatch.length) {
    throw new TenantDataPlaneClientError('tenant_data_plane_response_invalid');
  }
  return payload.results;
}

function migrationCommandVersionForSchema(schemaVersion) {
  if (schemaVersion === 7) return 3;
  if (schemaVersion === 8) return TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION;
  throw new TenantDataPlaneClientError('tenant_data_plane_schema_target_invalid', 500);
}

export async function migrateTenantDataPlaneSchema(context, env, targetSchemaVersion) {
  if (!tenantDataPlaneDispatchConfigured(env)) {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_unbound', 503);
  }
  const target = dataPlaneTarget(context);
  const schemaVersion = Number(targetSchemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new TenantDataPlaneClientError('tenant_data_plane_schema_target_invalid', 500);
  }
  const migrationCommandVersion = migrationCommandVersionForSchema(schemaVersion);

  let fetcher;
  try {
    fetcher = await tenantDispatchFetcher(env, target.workerScriptName);
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_unavailable', 503);
  }
  const request = new Request(new URL(TENANT_DATA_PLANE_MIGRATION_COMMAND_PATH, INTERNAL_ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-catalog-tenant-id': target.tenantId
    },
    body: JSON.stringify({
      version: migrationCommandVersion,
      tenantId: target.tenantId,
      targetSchemaVersion: schemaVersion
    })
  });

  let response;
  try {
    response = await fetcher.fetch(request);
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_failed', 503);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TenantDataPlaneClientError('tenant_data_plane_response_invalid');
  }
  if (
    !response.ok ||
    payload?.ok !== true ||
    Number(payload?.version) !== migrationCommandVersion
  ) {
    const code = /^tenant_data_plane_[a-z0-9_]+$/.test(String(payload?.error || ''))
      ? String(payload.error)
      : 'tenant_data_plane_migration_failed';
    throw new TenantDataPlaneClientError(code, response.status || 502);
  }
  if (Number(payload.schemaVersion) !== schemaVersion || typeof payload.applied !== 'boolean') {
    throw new TenantDataPlaneClientError('tenant_data_plane_response_invalid');
  }
  return { schemaVersion, applied: payload.applied };
}
