import { AdminAuthError, authenticateAdminRequest } from './admin-auth.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const MEDIA_ID_PATTERN = /^cm_[a-f0-9]{20}$/;
const PHOTO_HOST = 'photo.yupoo.com';
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 8_000;
const MAX_MEDIA_REDIRECTS = 3;
const SAFE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif'
]);

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

function mediaError(code, status) {
  return new Response(code, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
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

function publicMediaError(error) {
  if (error instanceof AdminAuthError) return mediaError(error.code, error.status);
  if (error?.status && error?.code) return mediaError(error.code, error.status);
  console.error('portal_construction_media_failed', 'construction_media_unavailable');
  return mediaError('construction_media_unavailable', 503);
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

function safePhotoUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.hostname.toLowerCase() === PHOTO_HOST
      ? url
      : null;
  } catch {
    return null;
  }
}

function safeYupooReferer(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i.test(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function readPrivateMedia(env, tenantId, mediaId) {
  const response = await projectionStub(env, tenantId).fetch(
    `https://construction.internal/media/${encodeURIComponent(mediaId)}`
  );
  if (response.status === 404) throw boundaryError('construction_media_not_found', 404);
  if (!response.ok) throw boundaryError('construction_media_unavailable', 503);
  const payload = await response.json().catch(() => null);
  const source = safePhotoUrl(payload?.sourceUrl);
  const referer = safeYupooReferer(payload?.refererUrl);
  if (!source || !referer || payload?.mediaId !== mediaId) {
    throw boundaryError('construction_media_upstream_rejected', 502);
  }
  return { source, referer };
}

async function fetchMediaUpstream(
  { source, referer },
  { method = 'GET', fetchImpl = fetch } = {}
) {
  let current = source.href;
  for (let redirects = 0; redirects <= MAX_MEDIA_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetchImpl(current, {
        method: method === 'HEAD' ? 'HEAD' : 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36',
          referer
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw boundaryError('construction_media_upstream_timeout', 504);
      throw boundaryError('construction_media_upstream_unavailable', 502);
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      await upstream.body?.cancel().catch(() => {});
      const next = location ? safePhotoUrl(new URL(location, current).href) : null;
      if (!next) throw boundaryError('construction_media_upstream_rejected', 502);
      current = next.href;
      continue;
    }
    return upstream;
  }
  throw boundaryError('construction_media_upstream_rejected', 502);
}

function safeMediaHeaders(upstream) {
  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase().split(';')[0];
  const contentLength = String(upstream.headers.get('content-length') || '');
  const length = Number(contentLength);
  if (!SAFE_IMAGE_TYPES.has(contentType)) {
    throw boundaryError('construction_media_upstream_rejected', 502);
  }
  if (!/^\d+$/.test(contentLength) || !Number.isFinite(length) || length < 1 || length > MAX_MEDIA_BYTES) {
    throw boundaryError('construction_media_upstream_rejected', 502);
  }
  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('content-length', String(length));
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  return headers;
}

function tenantIdFromPath(pathname) {
  return String(pathname || '').match(
    /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/construction-preview$/
  )?.[1] || null;
}

function constructionMediaFromPath(pathname) {
  const match = String(pathname || '').match(
    /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/construction-media\/(cm_[a-f0-9]{20})$/
  );
  return match ? { tenantId: match[1], mediaId: match[2] } : null;
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

export async function handlePortalConstructionMediaRequest(
  request,
  env,
  { authenticate = authenticateAdminRequest, fetchImpl = fetch } = {}
) {
  const route = constructionMediaFromPath(new URL(request.url).pathname);
  if (!route) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return mediaError('method_not_allowed', 405);

  try {
    if (!env.CATALOG_DB) throw boundaryError('control_plane_database_unbound', 503);
    const auth = await authenticate(request, env);
    await requireMembership(env.CATALOG_DB, route.tenantId, auth.principalId);
    const media = await readPrivateMedia(env, route.tenantId, route.mediaId);
    const upstream = await fetchMediaUpstream(media, { method: request.method, fetchImpl });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      throw boundaryError(
        upstream.status === 404 ? 'construction_media_not_found' : 'construction_media_upstream_unavailable',
        upstream.status === 404 ? 404 : 502
      );
    }
    let headers;
    try {
      headers = safeMediaHeaders(upstream);
    } catch (error) {
      await upstream.body?.cancel().catch(() => {});
      throw error;
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
  } catch (error) {
    return publicMediaError(error);
  }
}

export const constructionMediaContract = Object.freeze({
  maxBytes: MAX_MEDIA_BYTES,
  timeoutMs: MEDIA_TIMEOUT_MS,
  maxRedirects: MAX_MEDIA_REDIRECTS,
  mediaIdPattern: MEDIA_ID_PATTERN.source
});
