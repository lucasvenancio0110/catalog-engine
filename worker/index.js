import {
  buildUpstreamHeaders,
  mediaCacheKey,
  normalizeMediaId,
  parseAllowedSourceHosts,
  publicMediaHeaders,
  safeSourceUrl
} from './media-proxy.js';

const PRODUCT_ID_PATTERN = /^p_[a-f0-9]{20}$/;
const CATEGORY_ID_PATTERN = /^c_[a-f0-9]{20}$/;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 30;

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
  ).bind(mediaId).first();
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
  if (request.method !== 'GET' && request.method !== 'HEAD') return mediaError(405, 'method_not_allowed');
  const normalizedId = normalizeMediaId(mediaId);
  if (!normalizedId) return mediaError(404, 'media_not_found');
  const cacheKey = mediaCacheKey(request);
  const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
  if (edgeCache) {
    const cached = await edgeCache.match(cacheKey);
    if (cached) {
      return request.method === 'HEAD'
        ? new Response(null, { status: cached.status, headers: cached.headers })
        : cached;
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
  if (!sourceUrl) return mediaError(502, 'media_upstream_rejected');
  let upstream;
  try {
    upstream = await fetch(sourceUrl.href, {
      method: 'GET',
      redirect: 'follow',
      headers: buildUpstreamHeaders(sourceRecord.row.referer_url),
      cf: { cacheEverything: true, cacheTtl: upstreamCacheTtl(variant) }
    });
  } catch (error) {
    console.error('media_upstream_fetch_failed', normalizedId, variant, error?.message || error);
    return mediaError(502, 'media_upstream_unavailable');
  }
  if (!upstream.ok) return mediaError(upstream.status === 404 ? 404 : 502, 'media_upstream_unavailable');
  const finalSource = safeSourceUrl(upstream.url, allowedHosts);
  const responseHeaders = publicMediaHeaders(upstream.headers);
  if (!finalSource || !responseHeaders) {
    await upstream.body?.cancel();
    return mediaError(502, 'media_upstream_rejected');
  }
  responseHeaders.set('x-catalog-media-variant', variant);
  const response = new Response(upstream.body, { status: 200, headers: responseHeaders });
  if (edgeCache && request.method === 'GET') ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, { status: 200, headers: responseHeaders });
  }
  return response;
}

function normalizeSearchTerm(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeSlug(value = '') {
  return SAFE_SLUG_PATTERN.test(value) ? value : '';
}

function mediaDescriptor(mediaId) {
  if (!mediaId) return null;
  return {
    id: mediaId,
    url: `/media/${mediaId}/view`,
    thumbnailUrl: `/media/${mediaId}/thumb`,
    downloadUrl: `/media/${mediaId}`,
    storage: 'edge-proxy'
  };
}

function productFromRow(row, media = null) {
  const descriptor = media || mediaDescriptor(row.primary_media_id);
  return {
    id: row.product_id,
    name: row.display_name || row.name,
    category: row.display_category_name || row.category_name,
    categoryId: row.category_id,
    teamId: row.team_id || null,
    leagueId: row.league_id || null,
    description: row.description || '',
    imageCount: Number(row.image_count || 0),
    images: descriptor ? [descriptor.url] : [],
    media: descriptor ? [descriptor] : [],
    entityType: 'product'
  };
}

async function readMeta(env) {
  const result = await env.CATALOG_DB.prepare('SELECT key, value_json FROM catalog_meta').all();
  const meta = {};
  for (const row of result.results || []) {
    try {
      meta[row.key] = JSON.parse(row.value_json);
    } catch {
      meta[row.key] = null;
    }
  }
  return meta;
}

async function catalogMeta(env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  try {
    const meta = await readMeta(env);
    return json({
      store: meta.store || {},
      generatedAt: meta.generatedAt || null,
      stats: meta.stats || { products: 0 },
      storage: meta.storage || {},
      navigation: meta.navigation || [],
      normalization: meta.normalization || {},
      pageSize: DEFAULT_PAGE_SIZE
    }, 200, { 'cache-control': 'public, max-age=60, s-maxage=300' });
  } catch (error) {
    console.error('catalog_meta_failed', error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function listLeagues(url, env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  const entityType = url.searchParams.get('entityType') === 'national_team' ? 'national_team' : 'club';
  const country = String(url.searchParams.get('country') || '').slice(0, 12);
  const conditions = ['entity_type = ?'];
  const bindings = [entityType];
  if (country) {
    conditions.push('country_code = ?');
    bindings.push(country);
  }
  try {
    const result = await env.CATALOG_DB.prepare(
      `SELECT league_id, name, country_code, country_name, entity_type, logo_url, product_count
         FROM catalog_leagues
        WHERE ${conditions.join(' AND ')} AND product_count > 0
        ORDER BY sort_order, name`
    ).bind(...bindings).all();
    return json({ items: result.results || [] }, 200, { 'cache-control': 'public, max-age=120, s-maxage=600' });
  } catch (error) {
    console.error('catalog_leagues_failed', error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function listTeams(url, env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  const conditions = ['product_count > 0'];
  const bindings = [];
  const leagueId = safeSlug(url.searchParams.get('leagueId') || '');
  const country = String(url.searchParams.get('country') || '').slice(0, 12);
  const entityType = url.searchParams.get('entityType');
  if (leagueId) {
    conditions.push('league_id = ?');
    bindings.push(leagueId);
  }
  if (country) {
    conditions.push('country_code = ?');
    bindings.push(country);
  }
  if (entityType === 'club' || entityType === 'national_team') {
    conditions.push('entity_type = ?');
    bindings.push(entityType);
  }
  try {
    const statement = env.CATALOG_DB.prepare(
      `SELECT team_id, name, short_name, league_id, country_code, entity_type, logo_url, initials, product_count
         FROM catalog_teams
        WHERE ${conditions.join(' AND ')}
        ORDER BY product_count DESC, name ASC`
    );
    const result = bindings.length ? await statement.bind(...bindings).all() : await statement.all();
    return json({ items: result.results || [] }, 200, { 'cache-control': 'public, max-age=120, s-maxage=600' });
  } catch (error) {
    console.error('catalog_teams_failed', error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function listFacets(env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  try {
    const result = await env.CATALOG_DB.prepare(
      `SELECT facet_id, facet_type, name, product_count
         FROM catalog_facets
        WHERE product_count > 0
        ORDER BY sort_order, name`
    ).all();
    return json({ items: result.results || [] }, 200, { 'cache-control': 'public, max-age=120, s-maxage=600' });
  } catch (error) {
    console.error('catalog_facets_failed', error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function teamDetail(teamId, env) {
  if (!env.CATALOG_DB || !safeSlug(teamId)) return json({ error: 'team_not_found' }, 404);
  try {
    const team = await env.CATALOG_DB.prepare(
      `SELECT team_id, name, short_name, league_id, country_code, entity_type, logo_url, initials, product_count
         FROM catalog_teams
        WHERE team_id = ?1
        LIMIT 1`
    ).bind(teamId).first();
    if (!team) return json({ error: 'team_not_found' }, 404);
    const facets = await env.CATALOG_DB.prepare(
      `SELECT f.facet_id, f.facet_type, f.name, COUNT(DISTINCT p.product_id) AS product_count
         FROM catalog_facets f
         JOIN catalog_product_facets pf ON pf.facet_id = f.facet_id
         JOIN catalog_products p ON p.product_id = pf.product_id
        WHERE p.team_id = ?1
        GROUP BY f.facet_id, f.facet_type, f.name, f.sort_order
       HAVING product_count > 0
        ORDER BY f.sort_order, f.name`
    ).bind(teamId).all();
    return json({ team, facets: facets.results || [] }, 200, { 'cache-control': 'public, max-age=120, s-maxage=600' });
  } catch (error) {
    console.error('catalog_team_detail_failed', teamId, error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function listProducts(url, env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  const page = positiveInteger(url.searchParams.get('page'), 1, 100_000);
  const limit = positiveInteger(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const query = normalizeSearchTerm(url.searchParams.get('q') || '');
  const rawCategoryId = url.searchParams.get('categoryId') || '';
  const categoryId = CATEGORY_ID_PATTERN.test(rawCategoryId) ? rawCategoryId : '';
  const teamId = safeSlug(url.searchParams.get('teamId') || '');
  const leagueId = safeSlug(url.searchParams.get('leagueId') || '');
  const facetId = safeSlug(url.searchParams.get('facetId') || '');
  const offset = (page - 1) * limit;
  const conditions = [];
  const bindings = [];
  if (query) {
    conditions.push('p.search_text LIKE ?');
    bindings.push(`%${query}%`);
  }
  if (categoryId) {
    conditions.push('EXISTS (SELECT 1 FROM catalog_product_categories pc WHERE pc.product_id = p.product_id AND pc.category_id = ?)');
    bindings.push(categoryId);
  }
  if (teamId) {
    conditions.push('p.team_id = ?');
    bindings.push(teamId);
  }
  if (leagueId) {
    conditions.push('p.league_id = ?');
    bindings.push(leagueId);
  }
  if (facetId) {
    conditions.push('EXISTS (SELECT 1 FROM catalog_product_facets pf WHERE pf.product_id = p.product_id AND pf.facet_id = ?)');
    bindings.push(facetId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const countStatement = env.CATALOG_DB.prepare(`SELECT COUNT(*) AS total FROM catalog_products p ${where}`);
    const countRow = await (bindings.length ? countStatement.bind(...bindings) : countStatement).first();
    const total = Number(countRow?.total || 0);
    const totalPages = total ? Math.ceil(total / limit) : 0;
    const result = await env.CATALOG_DB.prepare(
      `SELECT p.product_id, p.name, p.display_name, p.category_id, p.category_name, p.display_category_name,
              p.description, p.team_id, p.league_id, p.image_count, p.primary_media_id, p.sort_order
         FROM catalog_products p
         ${where}
        ORDER BY p.sort_order ASC, p.product_id ASC
        LIMIT ? OFFSET ?`
    ).bind(...bindings, limit, offset).all();
    return json({
      items: (result.results || []).map((row) => productFromRow(row)),
      page,
      pageSize: limit,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasMore: page < totalPages,
      query,
      categoryId,
      teamId,
      leagueId,
      facetId
    }, 200, { 'cache-control': 'public, max-age=30, s-maxage=120' });
  } catch (error) {
    console.error('catalog_products_failed', error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
}

async function productDetail(productId, env) {
  if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
  if (!PRODUCT_ID_PATTERN.test(productId)) return json({ error: 'product_not_found' }, 404);
  try {
    const row = await env.CATALOG_DB.prepare(
      `SELECT product_id, name, display_name, category_id, category_name, display_category_name,
              description, team_id, league_id, image_count, primary_media_id, sort_order
         FROM catalog_products
        WHERE product_id = ?1
        LIMIT 1`
    ).bind(productId).first();
    if (!row) return json({ error: 'product_not_found' }, 404);
    const mediaResult = await env.CATALOG_DB.prepare(
      `SELECT media_id
         FROM product_media
        WHERE product_id = ?1
        ORDER BY position ASC`
    ).bind(productId).all();
    const media = (mediaResult.results || []).map((entry) => mediaDescriptor(entry.media_id));
    const product = productFromRow(row, null);
    product.media = media;
    product.images = media.map((entry) => entry.url);
    product.imageCount = media.length || product.imageCount;
    return json({ product }, 200, { 'cache-control': 'public, max-age=120, s-maxage=600' });
  } catch (error) {
    console.error('catalog_product_detail_failed', productId, error?.message || error);
    return json({ error: 'catalog_temporarily_unavailable' }, 503);
  }
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
        catalogApi: true,
        professionalTaxonomy: true,
        pageSize: DEFAULT_PAGE_SIZE,
        database: env.CATALOG_DB ? 'bound' : 'unbound'
      });
    }
    if (url.pathname === '/api/catalog/meta' && request.method === 'GET') return catalogMeta(env);
    if (url.pathname === '/api/leagues' && request.method === 'GET') return listLeagues(url, env);
    if (url.pathname === '/api/teams' && request.method === 'GET') return listTeams(url, env);
    if (url.pathname === '/api/facets' && request.method === 'GET') return listFacets(env);
    if (url.pathname.startsWith('/api/teams/') && request.method === 'GET') {
      try {
        return teamDetail(decodeURIComponent(url.pathname.slice('/api/teams/'.length)), env);
      } catch {
        return json({ error: 'team_not_found' }, 404);
      }
    }
    if (url.pathname === '/api/products' && request.method === 'GET') return listProducts(url, env);
    if (url.pathname.startsWith('/api/products/') && request.method === 'GET') {
      try {
        return productDetail(decodeURIComponent(url.pathname.slice('/api/products/'.length)), env);
      } catch {
        return json({ error: 'product_not_found' }, 404);
      }
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
