const DEFAULT_TENANT_ID = 't_00000000000000000001';
const DEFAULT_DATA_PLANE_KEY = 'catalog-engine-default';
const DEFAULT_ADMIN_HOST = 'app.catalogoengine.com';

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function platformHosts(env) {
  return new Set(
    String(env.CATALOG_PLATFORM_HOSTS || '')
      .split(',')
      .map(normalizeHostname)
      .filter(Boolean)
  );
}

function isLocalDevelopmentHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function isCatalogPlatformHost(request, env) {
  const hostname = normalizeHostname(new URL(request.url).hostname);
  return isLocalDevelopmentHost(hostname) || platformHosts(env).has(hostname);
}

export function isCatalogAdminHost(request, env) {
  const hostname = normalizeHostname(new URL(request.url).hostname);
  const adminHost = normalizeHostname(env.CATALOG_ADMIN_HOST || DEFAULT_ADMIN_HOST);
  return Boolean(adminHost) && hostname === adminHost;
}

export async function resolveStorefrontTenant(request, env) {
  const hostname = normalizeHostname(new URL(request.url).hostname);
  if (!hostname) return { allowed: false, reason: 'invalid_hostname', status: 404 };

  if (isLocalDevelopmentHost(hostname) || platformHosts(env).has(hostname)) {
    return {
      allowed: true,
      mode: 'platform_preview',
      hostname,
      tenantId: DEFAULT_TENANT_ID,
      dataPlaneKey: DEFAULT_DATA_PLANE_KEY
    };
  }

  if (!env.CATALOG_DB) {
    return { allowed: false, reason: 'storefront_database_unbound', status: 503 };
  }

  let row;
  try {
    row = await env.CATALOG_DB.prepare(
      `SELECT d.tenant_id, d.status AS domain_status,
              i.data_plane_key, i.status AS data_plane_status,
              p.setup_status,
              s.worker_script_name, s.worker_status,
              s.runtime_kind, s.runtime_status, s.runtime_version
         FROM tenant_domains d
         LEFT JOIN tenant_catalog_instances i ON i.tenant_id=d.tenant_id
         LEFT JOIN tenant_store_profiles p ON p.tenant_id=d.tenant_id
         LEFT JOIN tenant_data_plane_provider_state s ON s.tenant_id=d.tenant_id
        WHERE d.hostname=?1 AND d.domain_type='custom'
        LIMIT 1`
    )
      .bind(hostname)
      .first();
  } catch (error) {
    console.error('tenant_hostname_lookup_failed', String(error?.message || error).slice(0, 120));
    return { allowed: false, reason: 'storefront_temporarily_unavailable', status: 503 };
  }

  if (!row) return { allowed: false, reason: 'storefront_not_found', status: 404 };
  if (row.domain_status !== 'active') {
    return { allowed: false, reason: 'storefront_domain_not_active', status: 404 };
  }
  if (row.setup_status !== 'published') {
    return { allowed: false, reason: 'storefront_not_published', status: 404 };
  }
  if (row.data_plane_status !== 'ready' || !row.data_plane_key) {
    return { allowed: false, reason: 'storefront_not_ready', status: 503 };
  }

  if (row.tenant_id === DEFAULT_TENANT_ID && row.data_plane_key === DEFAULT_DATA_PLANE_KEY) {
    return {
      allowed: true,
      mode: 'custom_domain',
      hostname,
      tenantId: row.tenant_id,
      dataPlaneKey: row.data_plane_key
    };
  }

  // Future tenants are never allowed to fall through to the concrete tenant #0001 D1.
  // They become routable only when their server-resolved Workers for Platforms runtime
  // is active and verified. The client never supplies the script name.
  if (!row.worker_script_name || !row.worker_status || !row.runtime_kind || !row.runtime_status) {
    return { allowed: false, reason: 'tenant_data_plane_not_attached', status: 503 };
  }
  if (
    row.worker_status !== 'active' ||
    row.runtime_kind !== 'catalog' ||
    row.runtime_status !== 'verified' ||
    Number(row.runtime_version || 0) < 1
  ) {
    return { allowed: false, reason: 'tenant_runtime_not_ready', status: 503 };
  }

  return {
    allowed: true,
    mode: 'dispatch',
    hostname,
    tenantId: row.tenant_id,
    dataPlaneKey: row.data_plane_key,
    dispatchScriptName: row.worker_script_name,
    runtimeVersion: Number(row.runtime_version)
  };
}

export function storefrontRoutingError(resolution) {
  const status = resolution?.status === 503 ? 503 : 404;
  return new Response(JSON.stringify({ error: resolution?.reason || 'storefront_not_found' }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 404 ? 'public, max-age=30' : 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
