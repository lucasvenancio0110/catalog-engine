const SCRIPT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;

export class TenantDispatchError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'TenantDispatchError';
    this.code = code;
    this.status = status;
  }
}

export function tenantDispatchConfigured(env) {
  return Boolean(env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function');
}

export async function tenantDispatchFetcher(env, scriptName) {
  if (!tenantDispatchConfigured(env)) {
    throw new TenantDispatchError('tenant_dispatch_unbound');
  }
  const script = String(scriptName || '').trim();
  if (!SCRIPT_NAME_PATTERN.test(script)) {
    throw new TenantDispatchError('tenant_dispatch_script_invalid', 500);
  }

  let fetcher;
  try {
    fetcher = env.TENANT_DISPATCH.get(script);
    if (fetcher && typeof fetcher.then === 'function') fetcher = await fetcher;
  } catch {
    throw new TenantDispatchError('tenant_dispatch_lookup_failed');
  }
  if (!fetcher || typeof fetcher.fetch !== 'function') {
    throw new TenantDispatchError('tenant_dispatch_script_unavailable');
  }
  return fetcher;
}

export async function dispatchTenantRequest(request, env, scriptName) {
  const fetcher = await tenantDispatchFetcher(env, scriptName);
  try {
    return await fetcher.fetch(request);
  } catch {
    throw new TenantDispatchError('tenant_dispatch_fetch_failed');
  }
}

export async function smokeTenantRuntime(env, scriptName, expectedRuntimeVersion) {
  const fetcher = await tenantDispatchFetcher(env, scriptName);
  const base = 'https://tenant-runtime.internal';
  let health;
  let meta;
  try {
    health = await fetcher.fetch(new Request(`${base}/api/health`, { method: 'GET' }));
    meta = await fetcher.fetch(new Request(`${base}/api/catalog/meta`, { method: 'GET' }));
  } catch {
    throw new TenantDispatchError('tenant_runtime_smoke_fetch_failed');
  }
  if (!health.ok || !meta.ok) {
    await health.body?.cancel().catch(() => {});
    await meta.body?.cancel().catch(() => {});
    throw new TenantDispatchError('tenant_runtime_smoke_failed');
  }
  let healthJson;
  let metaJson;
  try {
    healthJson = await health.json();
    metaJson = await meta.json();
  } catch {
    throw new TenantDispatchError('tenant_runtime_smoke_invalid_response');
  }
  const products = Number(metaJson?.stats?.products || 0);
  if (
    healthJson?.ok !== true ||
    healthJson?.service !== 'catalog-engine-tenant' ||
    Number(healthJson?.runtimeVersion || 0) !== Number(expectedRuntimeVersion) ||
    healthJson?.catalogApi !== true ||
    healthJson?.mediaProxy !== true ||
    products < 1
  ) {
    throw new TenantDispatchError('tenant_runtime_smoke_mismatch');
  }
  return {
    runtimeVersion: Number(healthJson.runtimeVersion),
    schemaVersion: Number(healthJson.schemaVersion || 0),
    products
  };
}
