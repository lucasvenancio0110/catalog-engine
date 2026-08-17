import {
  buildUpstreamHeaders,
  mediaCacheKey,
  normalizeMediaId,
  parseAllowedSourceHosts,
  publicMediaHeaders,
  safeSourceUrl
} from './media-proxy.js';

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function mediaError(status, code) {
  return new Response(code, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': status === 404 ? 'public, max-age=60' : 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function parseMediaRequest(pathname) {
  const raw = pathname.slice('/media/'.length);
  const parts = raw.split('/');
  if (!parts[0] || parts.length > 2) return null;

  let mediaId;
  try {
    mediaId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }

  const variant = parts[1] || 'original';
  if (!['original', 'view', 'thumb'].includes(variant)) return null;
  return { mediaId, variant };
}

async function findMediaSource(env, mediaId) {
  if (!env.CATALOG_DB) return { state: 'unbound', row: null };

  const row = await env.CATALOG_DB.prepare(
    `SELECT source_url, display_source_url, thumbnail_source_url, referer_url, provider
       FROM media_sources
      WHERE media_id = ?1 AND active = 1
      LIMIT 1`
  )
    .bind(mediaId)
    .first();

  return { state: row ? 'found' : 'missing', row };
}

function sourceForVariant(row, variant) {
  if (variant === 'thumb') return row.thumbnail_source_url || row.display_source_url || row.source_url;
  if (variant === 'view') return row.display_source_url || row.source_url;
  return row.source_url;
}

function upstreamCacheTtl(variant) {
  if (variant === 'thumb') return 2_592_000;
  if (variant === 'view') return 1_209_600;
  return 604_800;
}

async function serveMedia(request, env, ctx, mediaId, variant = 'original') {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return mediaError(405, 'method_not_allowed');
  }

  const normalizedId = normalizeMediaId(mediaId);
  if (!normalizedId) return mediaError(404, 'media_not_found');

  const cacheKey = mediaCacheKey(request);
  const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
  if (edgeCache) {
    const cached = await edgeCache.match(cacheKey);
    if (cached) {
      if (request.method === 'HEAD') {
        return new Response(null, { status: cached.status, headers: cached.headers });
      }
      return cached;
    }
  }

  let sourceRecord;
  try {
    sourceRecord = await findMediaSource(env, normalizedId);
  } catch (error) {
    console.error('media_source_lookup_failed', normalizedId, error?.message || error);
    return mediaError(503, 'media_temporarily_unavailable');
  }

  if (sourceRecord.state === 'unbound') return mediaError(503, 'media_database_unbound');
  if (!sourceRecord.row) return mediaError(404, 'media_not_found');

  const allowedHosts = parseAllowedSourceHosts(env.MEDIA_ALLOWED_HOSTS);
  const selectedSource = sourceForVariant(sourceRecord.row, variant);
  const sourceUrl = safeSourceUrl(selectedSource, allowedHosts);
  if (!sourceUrl) {
    console.error('media_source_rejected', normalizedId, variant);
    return mediaError(502, 'media_upstream_rejected');
  }

  let upstream;
  try {
    upstream = await fetch(sourceUrl.href, {
      method: 'GET',
      redirect: 'follow',
      headers: buildUpstreamHeaders(sourceRecord.row.referer_url),
      cf: {
        cacheEverything: true,
        cacheTtl: upstreamCacheTtl(variant)
      }
    });
  } catch (error) {
    console.error('media_upstream_fetch_failed', normalizedId, variant, error?.message || error);
    return mediaError(502, 'media_upstream_unavailable');
  }

  if (!upstream.ok) {
    console.warn('media_upstream_status', normalizedId, variant, upstream.status);
    return mediaError(upstream.status === 404 ? 404 : 502, 'media_upstream_unavailable');
  }

  const finalSource = safeSourceUrl(upstream.url, allowedHosts);
  const responseHeaders = publicMediaHeaders(upstream.headers);
  if (!finalSource || !responseHeaders) {
    await upstream.body?.cancel();
    console.error('media_upstream_response_rejected', normalizedId, variant);
    return mediaError(502, 'media_upstream_rejected');
  }

  responseHeaders.set('x-catalog-media-variant', variant);
  const response = new Response(upstream.body, {
    status: 200,
    headers: responseHeaders
  });

  if (edgeCache && request.method === 'GET') {
    ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
  }

  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, { status: 200, headers: responseHeaders });
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'catalog-engine',
        mediaProxy: true,
        mediaVariants: true,
        database: env.CATALOG_DB ? 'bound' : 'unbound'
      });
    }

    if (url.pathname.startsWith('/media/')) {
      const mediaRequest = parseMediaRequest(url.pathname);
      if (!mediaRequest) return mediaError(404, 'media_not_found');
      return serveMedia(request, env, ctx, mediaRequest.mediaId, mediaRequest.variant);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    return env.ASSETS.fetch(request);
  }
};
