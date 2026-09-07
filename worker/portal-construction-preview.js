import { AdminAuthError, authenticateAdminRequest } from './admin-auth.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow, noarchive'
    }
  });
}

function boundaryError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function publicError(error) {
  if (error instanceof AdminAuthError) return json({ error: error.code }, error.status);
  if (error?.status && error?.code) return json({ error: error.code }, error.status);
  console.error('portal_construction_preview_failed', 'construction_preview_unavailable');
  return json({ error: 'construction_preview_unavailable' }, 503);
}

async function requireMembership(db, tenantId, principalId) {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw boundaryError('store_not_found', 404);
  const membership = await db
    .prepare(
      `SELECT role
         FROM tenant_memberships
        WHERE tenant_id=?1 AND principal_id=?2 AND status='active'
        LIMIT 1`
    )
    .bind(tenantId, principalId)
    .first();
  if (!membership) throw boundaryError('store_not_found', 404);
  return membership;
}

function requireConstructionNamespace(env) {
  const namespace = env?.TENANT_CONSTRUCTION_STATE;
  if (
    !namespace ||
    typeof namespace.idFromName !== 'function' ||
    typeof namespace.get !== 'function'
  ) {
    throw boundaryError('construction_preview_unavailable', 503);
  }
  return namespace;
}

function projectionStub(env, tenantId) {
  const namespace = requireConstructionNamespace(env);
  return namespace.get(namespace.idFromName(tenantId));
}

async function readProjection(env, tenantId) {
  const response = await projectionStub(env, tenantId).fetch('https://construction.internal/projection');
  if (!response.ok) throw boundaryError('construction_preview_unavailable', 503);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw boundaryError('construction_preview_unavailable', 503);
  }
  if (
    Number(payload?.version) !== 1 ||
    !['empty', 'indexed'].includes(payload?.readiness) ||
    typeof payload?.ready !== 'boolean' ||
    payload?.complete !== false ||
    !Number.isInteger(payload?.productCount) ||
    payload.productCount < 0 ||
    !Array.isArray(payload?.products)
  ) {
    throw boundaryError('construction_preview_unavailable', 503);
  }
  return payload;
}

function tenantIdFromPath(pathname) {
  return String(pathname || '').match(
    /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/construction-preview$/
  )?.[1] || null;
}

export async function handlePortalConstructionPreviewRequest(
  request,
  env,
  { authenticate = authenticateAdminRequest } = {}
) {
  const url = new URL(request.url);
  const tenantId = tenantIdFromPath(url.pathname);
  if (!tenantId) return null;
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (!env.CATALOG_DB) throw boundaryError('control_plane_database_unbound', 503);
    const auth = await authenticate(request, env);
    await requireMembership(env.CATALOG_DB, tenantId, auth.principalId);
    return json(await readProjection(env, tenantId));
  } catch (error) {
    return publicError(error);
  }
}
