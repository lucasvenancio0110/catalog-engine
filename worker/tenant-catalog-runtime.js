export const TENANT_CATALOG_RUNTIME_VERSION = 1;

export function tenantCatalogRuntimeFactory() {
  const PRODUCT_ID = /^p_[a-f0-9]{20}$/;
  const CATEGORY_ID = /^c_[a-f0-9]{20}$/;
  const MEDIA_ID = /^m_[a-f0-9]{20}$/;
  const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const TENANT_ID = /^t_[a-f0-9]{20}$/;
  const DEFAULT_PAGE_SIZE = 15;
  const MAX_PAGE_SIZE = 30;
  const RUNTIME_VERSION = 1;

  function json(payload, status = 200, cacheControl = 'no-store') {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': cacheControl,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      }
    });
  }

  function textError(status, code) {
    return new Response(code, {
      status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': status === 404 ? 'public, max-age=60' : 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      }
    });
  }

  function safeSlug(value = '') {
    return SAFE_SLUG.test(String(value)) ? String(value) : '';
  }

  function normalizeCatalogSort(value = '') {
    return ['name-asc', 'name-desc'].includes(String(value)) ? String(value) : 'catalog';
  }

  function catalogOrderBy(sort) {
    if (sort === 'name-asc') {
      return `COALESCE(NULLIF(p.display_name, ''), p.name) COLLATE NOCASE ASC, p.product_id ASC`;
    }
    if (sort === 'name-desc') {
      return `COALESCE(NULLIF(p.display_name, ''), p.name) COLLATE NOCASE DESC, p.product_id ASC`;
    }
    return 'p.sort_order ASC, p.product_id ASC';
  }

  function positiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
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

  function mediaDescriptor(mediaId) {
    if (!MEDIA_ID.test(String(mediaId || ''))) return null;
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
      teamName: row.team_name || null,
      leagueId: row.league_id || null,
      leagueName: row.league_name || null,
      description: row.description || '',
      imageCount: Number(row.image_count || 0),
      images: descriptor ? [descriptor.url] : [],
      media: descriptor ? [descriptor] : [],
      entityType: 'product'
    };
  }

  async function health(env) {
    if (!env.CATALOG_DB || !TENANT_ID.test(String(env.TENANT_ID || ''))) {
      return json({ ok: false, error: 'tenant_runtime_unbound' }, 503);
    }
    try {
      const identity = await env.CATALOG_DB.prepare(
        'SELECT tenant_id, schema_version FROM data_plane_identity WHERE tenant_id=?1 LIMIT 1'
      )
        .bind(env.TENANT_ID)
        .first();
      if (
        !identity ||
        identity.tenant_id !== env.TENANT_ID ||
        Number(identity.schema_version || 0) < 3
      ) {
        return json({ ok: false, error: 'tenant_runtime_identity_mismatch' }, 503);
      }
      return json({
        ok: true,
        service: 'catalog-engine-tenant',
        runtimeVersion: RUNTIME_VERSION,
        schemaVersion: Number(identity.schema_version),
        catalogApi: true,
        mediaProxy: true,
        database: 'bound'
      });
    } catch {
      return json({ ok: false, error: 'tenant_runtime_temporarily_unavailable' }, 503);
    }
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
      return json(
        {
          store: meta.store || {},
          generatedAt: meta.generatedAt || null,
          stats: meta.stats || { products: 0 },
          storage: meta.storage || { mode: 'edge-proxy' },
          navigation: meta.navigation || [],
          normalization: meta.normalization || {},
          classification: meta.classification || {},
          pageSize: DEFAULT_PAGE_SIZE
        },
        200,
        'public, max-age=60, s-maxage=300'
      );
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function listCategories(env) {
    if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
    try {
      const result = await env.CATALOG_DB.prepare(
        `SELECT category_id, name, parent_id, depth, sort_order, product_count
           FROM catalog_categories
          WHERE product_count > 0
          ORDER BY depth ASC, sort_order ASC, name ASC`
      ).all();
      return json({ items: result.results || [] }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function listLeagues(url, env) {
    if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
    const entityType =
      url.searchParams.get('entityType') === 'national_team' ? 'national_team' : 'club';
    const country = String(url.searchParams.get('country') || '').slice(0, 12);
    const conditions = ['entity_type=?1', 'product_count>0'];
    const bindings = [entityType];
    if (country) {
      conditions.push(`country_code=?${bindings.length + 1}`);
      bindings.push(country);
    }
    try {
      const result = await env.CATALOG_DB.prepare(
        `SELECT league_id, name, country_code, country_name, entity_type, logo_url, product_count
           FROM catalog_leagues
          WHERE ${conditions.join(' AND ')}
          ORDER BY sort_order ASC, name ASC`
      )
        .bind(...bindings)
        .all();
      return json({ items: result.results || [] }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function listTeams(url, env) {
    if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
    const conditions = ['product_count>0'];
    const bindings = [];
    const leagueId = safeSlug(url.searchParams.get('leagueId') || '');
    const country = String(url.searchParams.get('country') || '').slice(0, 12);
    const entityType = url.searchParams.get('entityType');
    if (leagueId) {
      conditions.push(`league_id=?${bindings.length + 1}`);
      bindings.push(leagueId);
    }
    if (country) {
      conditions.push(`country_code=?${bindings.length + 1}`);
      bindings.push(country);
    }
    if (entityType === 'club' || entityType === 'national_team') {
      conditions.push(`entity_type=?${bindings.length + 1}`);
      bindings.push(entityType);
    }
    try {
      const statement = env.CATALOG_DB.prepare(
        `SELECT team_id, name, short_name, league_id, country_code, entity_type,
                logo_url, initials, product_count
           FROM catalog_teams
          WHERE ${conditions.join(' AND ')}
          ORDER BY product_count DESC, name ASC`
      );
      const result = bindings.length
        ? await statement.bind(...bindings).all()
        : await statement.all();
      return json({ items: result.results || [] }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
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
          ORDER BY sort_order ASC, name ASC`
      ).all();
      return json({ items: result.results || [] }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function teamDetail(teamId, env) {
    if (!env.CATALOG_DB || !safeSlug(teamId)) return json({ error: 'team_not_found' }, 404);
    try {
      const team = await env.CATALOG_DB.prepare(
        `SELECT team_id, name, short_name, league_id, country_code, entity_type,
                logo_url, initials, product_count
           FROM catalog_teams WHERE team_id=?1 LIMIT 1`
      )
        .bind(teamId)
        .first();
      if (!team) return json({ error: 'team_not_found' }, 404);
      const facets = await env.CATALOG_DB.prepare(
        `SELECT f.facet_id, f.facet_type, f.name, COUNT(DISTINCT p.product_id) AS product_count
           FROM catalog_facets f
           JOIN catalog_product_facets pf ON pf.facet_id=f.facet_id
           JOIN catalog_products p ON p.product_id=pf.product_id
          WHERE p.team_id=?1
          GROUP BY f.facet_id, f.facet_type, f.name, f.sort_order
         HAVING product_count>0
          ORDER BY f.sort_order ASC, f.name ASC`
      )
        .bind(teamId)
        .all();
      return json({ team, facets: facets.results || [] }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function listProducts(url, env) {
    if (!env.CATALOG_DB) return json({ error: 'catalog_database_unbound' }, 503);
    const page = positiveInteger(url.searchParams.get('page'), 1, 100000);
    const limit = positiveInteger(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const query = normalizeSearchTerm(url.searchParams.get('q') || '');
    const rawCategoryId = String(url.searchParams.get('categoryId') || '');
    const categoryId = CATEGORY_ID.test(rawCategoryId) ? rawCategoryId : '';
    const teamId = safeSlug(url.searchParams.get('teamId') || '');
    const leagueId = safeSlug(url.searchParams.get('leagueId') || '');
    const facetId = safeSlug(url.searchParams.get('facetId') || '');
    const sort = normalizeCatalogSort(url.searchParams.get('sort') || '');
    const conditions = [];
    const bindings = [];
    if (query) {
      conditions.push(`p.search_text LIKE ?${bindings.length + 1}`);
      bindings.push(`%${query}%`);
    }
    if (categoryId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM catalog_product_categories pc WHERE pc.product_id=p.product_id AND pc.category_id=?${bindings.length + 1})`
      );
      bindings.push(categoryId);
    }
    if (teamId) {
      conditions.push(`p.team_id=?${bindings.length + 1}`);
      bindings.push(teamId);
    }
    if (leagueId) {
      conditions.push(`p.league_id=?${bindings.length + 1}`);
      bindings.push(leagueId);
    }
    if (facetId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM catalog_product_facets pf WHERE pf.product_id=p.product_id AND pf.facet_id=?${bindings.length + 1})`
      );
      bindings.push(facetId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    try {
      const countStatement = env.CATALOG_DB.prepare(
        `SELECT COUNT(*) AS total FROM catalog_products p ${where}`
      );
      const countRow = await (
        bindings.length ? countStatement.bind(...bindings) : countStatement
      ).first();
      const total = Number(countRow?.total || 0);
      const result = await env.CATALOG_DB.prepare(
        `SELECT p.product_id, p.name, p.display_name, p.category_id, p.category_name,
                p.display_category_name, p.description, p.team_id, t.name AS team_name,
                p.league_id, l.name AS league_name, p.image_count, p.primary_media_id, p.sort_order
           FROM catalog_products p
           LEFT JOIN catalog_teams t ON t.team_id=p.team_id
           LEFT JOIN catalog_leagues l ON l.league_id=p.league_id
           ${where}
          ORDER BY ${catalogOrderBy(sort)}
          LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`
      )
        .bind(...bindings, limit, offset)
        .all();
      const totalPages = total ? Math.ceil(total / limit) : 0;
      return json(
        {
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
          facetId,
          sort
        },
        200,
        'public, max-age=30, s-maxage=120'
      );
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  async function productDetail(productId, env) {
    if (!env.CATALOG_DB || !PRODUCT_ID.test(String(productId || ''))) {
      return json({ error: 'product_not_found' }, 404);
    }
    try {
      const row = await env.CATALOG_DB.prepare(
        `SELECT p.product_id, p.name, p.display_name, p.category_id, p.category_name,
                p.display_category_name, p.description, p.team_id, t.name AS team_name,
                p.league_id, l.name AS league_name, p.image_count, p.primary_media_id, p.sort_order
           FROM catalog_products p
           LEFT JOIN catalog_teams t ON t.team_id=p.team_id
           LEFT JOIN catalog_leagues l ON l.league_id=p.league_id
          WHERE p.product_id=?1 LIMIT 1`
      )
        .bind(productId)
        .first();
      if (!row) return json({ error: 'product_not_found' }, 404);
      const mediaRows = await env.CATALOG_DB.prepare(
        'SELECT media_id FROM product_media WHERE product_id=?1 ORDER BY position ASC'
      )
        .bind(productId)
        .all();
      const media = (mediaRows.results || [])
        .map((entry) => mediaDescriptor(entry.media_id))
        .filter(Boolean);
      const product = productFromRow(row, null);
      product.media = media;
      product.images = media.map((entry) => entry.url);
      product.imageCount = media.length || product.imageCount;
      return json({ product }, 200, 'public, max-age=120, s-maxage=600');
    } catch {
      return json({ error: 'catalog_temporarily_unavailable' }, 503);
    }
  }

  function parseMediaRequest(pathname) {
    const parts = pathname.slice('/media/'.length).split('/');
    if (!parts[0] || parts.length > 2) return null;
    let mediaId;
    try {
      mediaId = decodeURIComponent(parts[0]);
    } catch {
      return null;
    }
    if (!MEDIA_ID.test(mediaId)) return null;
    const variant = parts[1] || 'original';
    if (!['original', 'view', 'thumb'].includes(variant)) return null;
    return { mediaId, variant };
  }

  function sourceForVariant(row, variant) {
    if (variant === 'thumb')
      return row.thumbnail_source_url || row.display_source_url || row.source_url;
    if (variant === 'view') return row.display_source_url || row.source_url;
    return row.source_url;
  }

  function safePhotoUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname.toLowerCase() === 'photo.yupoo.com'
        ? url
        : null;
    } catch {
      return null;
    }
  }

  function safeReferer(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.x.yupoo.com')
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  async function fetchMediaUpstream(source, referer, requestMethod) {
    let current = source.href;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const upstream = await fetch(current, {
        method: requestMethod === 'HEAD' ? 'HEAD' : 'GET',
        redirect: 'manual',
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36',
          ...(referer ? { referer } : {})
        },
        cf: { cacheEverything: true, cacheTtl: 604800 }
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get('location');
        await upstream.body?.cancel().catch(() => {});
        const next = location ? safePhotoUrl(new URL(location, current).href) : null;
        if (!next) return null;
        current = next.href;
        continue;
      }
      return upstream;
    }
    return null;
  }

  function publicImageHeaders(headers) {
    const contentType = String(headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const output = new Headers();
    output.set('content-type', contentType.split(';')[0]);
    const length = headers.get('content-length');
    if (length && /^\d+$/.test(length)) output.set('content-length', length);
    output.set('cache-control', 'public, max-age=604800, s-maxage=2592000, immutable');
    output.set('x-content-type-options', 'nosniff');
    output.set('referrer-policy', 'no-referrer');
    return output;
  }

  async function serveMedia(request, env, ctx, mediaId, variant) {
    if (!['GET', 'HEAD'].includes(request.method)) return textError(405, 'method_not_allowed');
    if (!env.CATALOG_DB) return textError(503, 'media_database_unbound');
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(request.url, { method: 'GET' });
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return request.method === 'HEAD'
          ? new Response(null, { status: cached.status, headers: cached.headers })
          : cached;
      }
    }
    let row;
    try {
      row = await env.CATALOG_DB.prepare(
        `SELECT source_url, display_source_url, thumbnail_source_url, referer_url
           FROM media_sources WHERE media_id=?1 AND active=1 LIMIT 1`
      )
        .bind(mediaId)
        .first();
    } catch {
      return textError(503, 'media_temporarily_unavailable');
    }
    if (!row) return textError(404, 'media_not_found');
    const source = safePhotoUrl(sourceForVariant(row, variant));
    if (!source) return textError(502, 'media_upstream_rejected');
    let upstream;
    try {
      upstream = await fetchMediaUpstream(source, safeReferer(row.referer_url), request.method);
    } catch {
      return textError(502, 'media_upstream_unavailable');
    }
    if (!upstream || !upstream.ok) {
      await upstream?.body?.cancel().catch(() => {});
      return textError(upstream?.status === 404 ? 404 : 502, 'media_upstream_unavailable');
    }
    const headers = publicImageHeaders(upstream.headers);
    if (!headers) {
      await upstream.body?.cancel().catch(() => {});
      return textError(502, 'media_upstream_rejected');
    }
    headers.set('x-catalog-media-variant', variant);
    const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers
    });
    if (cache && request.method === 'GET' && ctx?.waitUntil)
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    if (request.method === 'HEAD') await upstream.body?.cancel().catch(() => {});
    return response;
  }

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === '/api/health') return health(env);
      if (url.pathname === '/api/catalog/meta' && request.method === 'GET') return catalogMeta(env);
      if (url.pathname === '/api/categories' && request.method === 'GET')
        return listCategories(env);
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
      if (url.pathname === '/api/products' && request.method === 'GET')
        return listProducts(url, env);
      if (url.pathname.startsWith('/api/products/') && request.method === 'GET') {
        try {
          return productDetail(
            decodeURIComponent(url.pathname.slice('/api/products/'.length)),
            env
          );
        } catch {
          return json({ error: 'product_not_found' }, 404);
        }
      }
      if (url.pathname.startsWith('/media/')) {
        const media = parseMediaRequest(url.pathname);
        if (!media) return textError(404, 'media_not_found');
        return serveMedia(request, env, ctx, media.mediaId, media.variant);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return json({ error: 'tenant_static_assets_are_platform_owned' }, 404);
    }
  };
}

export const tenantCatalogRuntime = tenantCatalogRuntimeFactory();

export function tenantCatalogWorkerSource() {
  return `const factory = ${tenantCatalogRuntimeFactory.toString()};\nexport default factory();\n`;
}
