export const TENANT_DATA_PLANE_COMMAND_VERSION = 1;
export const TENANT_DATA_PLANE_COMMAND_PATH = '/_catalog/internal/d1-batch';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const MAX_BODY_BYTES = 512_000;
const MAX_BATCH_SIZE = 100;
const MAX_SQL_BYTES = 100_000;
const MAX_PARAMS = 100;
const ALLOWED_SQL_PREFIX = /^(SELECT|INSERT|UPDATE|DELETE)\b/i;

export class TenantDataPlaneCommandError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'TenantDataPlaneCommandError';
    this.code = code;
    this.status = status;
  }
}

function normalizeParam(value) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TenantDataPlaneCommandError('tenant_data_plane_param_invalid');
}

export function normalizeTenantDataPlaneBatch(batch) {
  if (!Array.isArray(batch) || batch.length < 1 || batch.length > MAX_BATCH_SIZE) {
    throw new TenantDataPlaneCommandError('tenant_data_plane_batch_invalid');
  }

  return batch.map((query) => {
    const sql = String(query?.sql || '').trim();
    const sqlBytes = new TextEncoder().encode(sql).byteLength;
    if (
      !sql ||
      sqlBytes > MAX_SQL_BYTES ||
      !ALLOWED_SQL_PREFIX.test(sql) ||
      sql.includes(';') ||
      /(?:--|\/\*)/.test(sql)
    ) {
      throw new TenantDataPlaneCommandError('tenant_data_plane_sql_invalid');
    }

    const params = Array.isArray(query?.params) ? query.params.map(normalizeParam) : [];
    if (params.length > MAX_PARAMS) {
      throw new TenantDataPlaneCommandError('tenant_data_plane_params_invalid');
    }
    return { sql, params };
  });
}

function safeJsonError(code, status) {
  return Response.json(
    { ok: false, error: code },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}

export async function handleTenantDataPlaneCommand(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== TENANT_DATA_PLANE_COMMAND_PATH) return null;
  if (request.method !== 'POST') return safeJsonError('method_not_allowed', 405);
  if (!env?.CATALOG_DB || typeof env.CATALOG_DB.batch !== 'function') {
    return safeJsonError('tenant_data_plane_database_unbound', 503);
  }

  const boundTenantId = String(env.TENANT_ID || '').trim();
  const requestedTenantId = String(request.headers.get('x-catalog-tenant-id') || '').trim();
  if (!TENANT_ID_PATTERN.test(boundTenantId) || requestedTenantId !== boundTenantId) {
    return safeJsonError('tenant_data_plane_tenant_mismatch', 403);
  }

  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return safeJsonError('tenant_data_plane_content_type_invalid', 415);
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return safeJsonError('tenant_data_plane_body_too_large', 413);
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return safeJsonError('tenant_data_plane_body_invalid', 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return safeJsonError('tenant_data_plane_body_too_large', 413);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return safeJsonError('tenant_data_plane_body_invalid', 400);
  }

  if (
    Number(payload?.version) !== TENANT_DATA_PLANE_COMMAND_VERSION ||
    String(payload?.tenantId || '') !== boundTenantId
  ) {
    return safeJsonError('tenant_data_plane_contract_invalid', 400);
  }

  let batch;
  try {
    batch = normalizeTenantDataPlaneBatch(payload.batch);
  } catch (error) {
    const code = error instanceof TenantDataPlaneCommandError
      ? error.code
      : 'tenant_data_plane_contract_invalid';
    const status = error instanceof TenantDataPlaneCommandError ? error.status : 400;
    return safeJsonError(code, status);
  }

  try {
    const statements = batch.map(({ sql, params }) => env.CATALOG_DB.prepare(sql).bind(...params));
    const results = await env.CATALOG_DB.batch(statements);
    if (!Array.isArray(results) || results.length !== batch.length) {
      return safeJsonError('tenant_data_plane_query_failed', 502);
    }
    return Response.json(
      { ok: true, version: TENANT_DATA_PLANE_COMMAND_VERSION, results },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch {
    return safeJsonError('tenant_data_plane_query_failed', 502);
  }
}

function commandRuntimeFactorySource() {
  return `const TENANT_DATA_PLANE_COMMAND_VERSION=${TENANT_DATA_PLANE_COMMAND_VERSION};\nconst TENANT_DATA_PLANE_COMMAND_PATH=${JSON.stringify(TENANT_DATA_PLANE_COMMAND_PATH)};\nconst TENANT_ID_PATTERN=/^t_[a-f0-9]{20}$/;\nconst MAX_BODY_BYTES=${MAX_BODY_BYTES};\nconst MAX_BATCH_SIZE=${MAX_BATCH_SIZE};\nconst MAX_SQL_BYTES=${MAX_SQL_BYTES};\nconst MAX_PARAMS=${MAX_PARAMS};\nconst ALLOWED_SQL_PREFIX=/^(SELECT|INSERT|UPDATE|DELETE)\\b/i;\n${normalizeParam.toString()}\n${normalizeTenantDataPlaneBatch.toString()}\n${safeJsonError.toString()}\n${handleTenantDataPlaneCommand.toString()}\n`;
}

export function wrapTenantWorkerSourceWithDataPlaneCommand(baseSource) {
  const source = String(baseSource || '');
  const marker = 'export default factory();';
  if (!source.includes(marker)) {
    throw new TenantDataPlaneCommandError('tenant_worker_source_marker_missing', 500);
  }
  const base = source.replace(marker, 'const __catalogBaseRuntime = factory();');
  return `${commandRuntimeFactorySource()}\n${base}\nexport default {\n  async fetch(request, env, ctx) {\n    const internal = await handleTenantDataPlaneCommand(request, env);\n    if (internal) return internal;\n    return __catalogBaseRuntime.fetch(request, env, ctx);\n  }\n};\n`;
}

export function tenantBootstrapWorkerSourceWithDataPlaneCommand() {
  const baseFactory = function bootstrapFactory() {
    return {
      async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/health') {
          return Response.json(
            {
              ok: true,
              service: 'catalog-engine-tenant',
              tenantId: env.TENANT_ID,
              database: env.CATALOG_DB ? 'bound' : 'unbound',
              status: 'provisioning'
            },
            { headers: { 'cache-control': 'no-store' } }
          );
        }
        return Response.json(
          { error: 'tenant_catalog_provisioning' },
          { status: 503, headers: { 'cache-control': 'no-store' } }
        );
      }
    };
  };
  const baseSource = `const factory = ${baseFactory.toString()};\nexport default factory();\n`;
  return wrapTenantWorkerSourceWithDataPlaneCommand(baseSource);
}
