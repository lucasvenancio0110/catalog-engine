import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { sha256Hex } from '../runtime-identity.js';

const MAX_HTML_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const REQUEST_ATTEMPTS = 4;
const YUPOO_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;
const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const LISTING_FINGERPRINT_VERSION = 2;

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function absolute(base, value) {
  if (!value) return null;
  if (String(value).startsWith('//')) return `https:${value}`;
  try {
    return new URL(String(value), base).href;
  } catch {
    return null;
  }
}

function assertYupooUrl(value, expectedHost = null) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !YUPOO_HOST_PATTERN.test(url.hostname)) {
    throw new Error('supplier_url_rejected');
  }
  if (expectedHost && url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error('supplier_redirect_rejected');
  }
  return url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url, { sourceHost, fetchImpl = fetch }) {
  let current = assertYupooUrl(url, sourceHost).href;
  let lastError;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let redirects = 0;
      while (redirects <= 3) {
        const response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
            'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
            accept: 'text/html,application/xhtml+xml'
          }
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => {});
          if (!location) throw new Error('supplier_redirect_without_location');
          current = assertYupooUrl(new URL(location, current).href, sourceHost).href;
          redirects += 1;
          continue;
        }

        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => {});
          throw Object.assign(new Error(`supplier_transient_${response.status}`), { transient: true });
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Object.assign(new Error(`supplier_http_${response.status}`), { status: response.status });
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_HTML_BYTES) {
          await response.body?.cancel().catch(() => {});
          throw new Error('supplier_html_too_large');
        }
        const html = await response.text();
        if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
          throw new Error('supplier_html_too_large');
        }
        return html;
      }
      throw new Error('supplier_redirect_limit');
    } catch (error) {
      lastError = error;
      if (!error?.transient && error?.name !== 'AbortError') throw error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < REQUEST_ATTEMPTS) await sleep(Math.min(4000, 350 * 2 ** (attempt - 1)));
  }
  throw lastError || new Error('supplier_fetch_failed');
}

function pagedUrl(base, page) {
  const url = new URL(base);
  if (page <= 1) {
    url.searchParams.delete('page');
    return url.href;
  }
  if (!url.searchParams.has('tab')) url.searchParams.set('tab', 'gallery');
  url.searchParams.set('page', String(page));
  return url.href;
}

function albumSourceId(href) {
  try {
    const match = new URL(href).pathname.match(/\/albums\/(\d+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeAlbumUrl(baseUrl, href) {
  const raw = absolute(baseUrl, href);
  if (!raw) return null;
  try {
    const url = assertYupooUrl(raw, new URL(baseUrl).hostname);
    if (!url.pathname.match(/\/albums\/\d+/i)) return null;
    if (!url.searchParams.has('uid')) url.searchParams.set('uid', '1');
    return url.href;
  } catch {
    return null;
  }
}

function imageCandidates(element, baseUrl) {
  const values = [];
  const keys = ['data-src', 'data-origin', 'data-original', 'src'];
  for (const key of keys) {
    const value = element.attr(key);
    if (value) values.push(value);
  }
  const srcset = element.attr('srcset');
  if (srcset) {
    for (const part of srcset.split(',')) values.push(part.trim().split(/\s+/)[0]);
  }
  return values.map((value) => absolute(baseUrl, value)).filter(Boolean);
}

function sourceImageFromCard(card, baseUrl) {
  const candidates = [];
  card.find('img').each((_index, element) => candidates.push(...imageCandidates(cheerio.load(element).root(), baseUrl)));
  return candidates.find((value) => /photo\.yupoo\.com/i.test(value)) || candidates[0] || null;
}

function listingSignal(card) {
  const candidates = [
    card.attr('data-id'),
    card.attr('data-album-id'),
    card.attr('data-update-time'),
    card.attr('data-updated-at'),
    card.find('[data-id]').first().attr('data-id'),
    card.find('time').first().attr('datetime'),
    card.find('time').first().text()
  ];
  return cleanText(candidates.find((value) => cleanText(value)) || '');
}

function imageCountHint(card) {
  const text = cleanText(card.text());
  const candidates = [
    card.attr('data-image-count'),
    card.attr('data-photo-count'),
    card.find('[data-image-count]').first().attr('data-image-count'),
    card.find('.album__count, .album__photo-count, .photo-count').first().text(),
    text.match(/(?:photos?|images?|pics?)\s*[:：]?\s*(\d{1,4})/i)?.[1],
    text.match(/(\d{1,4})\s*(?:photos?|images?|pics?)/i)?.[1]
  ];
  const raw = candidates.find((value) => /^\d{1,4}$/.test(cleanText(value)));
  return raw === undefined ? null : Number(raw);
}

export function parseYupooListingHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const bySourceId = new Map();
  $('a[href*="/albums/"]').each((_index, element) => {
    const anchor = $(element);
    const url = normalizeAlbumUrl(pageUrl, anchor.attr('href'));
    if (!url) return;
    const sourceId = albumSourceId(url);
    if (!sourceId || bySourceId.has(sourceId)) return;
    const card = anchor.closest('li, article, .album, .showalbum, .album__main, .image__main, div');
    const scope = card.length ? card : anchor;
    const title = cleanText(
      anchor.attr('title') ||
        scope.find('.album__title, .showalbumheader__gallerytitle, .image__title, h3, h4').first().text() ||
        anchor.text()
    );
    bySourceId.set(sourceId, {
      sourceId,
      sourceUrl: url,
      sourceTitle: title,
      coverSourceUrl: sourceImageFromCard(scope, pageUrl),
      imageCountHint: imageCountHint(scope),
      listingSignal: listingSignal(scope)
    });
  });
  return [...bySourceId.values()];
}

function categoryIdFromHref(href) {
  try {
    return new URL(href).pathname.match(/\/categories\/(\d+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function categoriesFromHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const sourceHost = new URL(sourceUrl).hostname;
  const byId = new Map();

  function upsert(category) {
    if (!category?.id || !cleanText(category.name)) return;
    const id = String(category.id);
    const previous = byId.get(id) || {};
    byId.set(id, {
      id,
      name: cleanText(category.name || previous.name),
      parentId: category.parentId ? String(category.parentId) : previous.parentId || null,
      sourceUrl: category.sourceUrl || previous.sourceUrl || new URL(`/categories/${id}`, sourceUrl).href
    });
  }

  $('script').each((_index, element) => {
    const text = $(element).html() || '';
    const match = text.match(/categoryData\s*:\s*(\[[\s\S]*?\])\s*,\s*(?:settings|showcase|sort|watermark|language)/);
    if (!match) return;
    try {
      const rows = JSON.parse(match[1]);
      for (const row of rows) {
        upsert({ id: row.id, name: row.name, parentId: row.parent_id, sourceUrl: new URL(`/categories/${row.id}`, sourceUrl).href });
      }
    } catch {
      // Anchor extraction below remains the fallback.
    }
  });

  $('a[href*="/categories/"]').each((_index, element) => {
    const anchor = $(element);
    const href = absolute(sourceUrl, anchor.attr('href'));
    if (!href) return;
    try {
      const url = assertYupooUrl(href, sourceHost);
      const id = categoryIdFromHref(url.href);
      if (!id) return;
      upsert({ id, name: cleanText(anchor.text() || anchor.attr('title')), sourceUrl: url.href });
    } catch {
      // Ignore links outside the source host.
    }
  });

  return [...byId.values()];
}

function normalizeTaxonomy(categories) {
  const byId = new Map(categories.map((category) => [String(category.id), { ...category, id: String(category.id) }]));
  for (const category of byId.values()) {
    if (category.parentId && !byId.has(String(category.parentId))) category.parentId = null;
  }

  function depthFor(category, visiting = new Set()) {
    if (!category?.parentId || visiting.has(category.id)) return 0;
    const parent = byId.get(String(category.parentId));
    if (!parent) return 0;
    const next = new Set(visiting);
    next.add(category.id);
    return Math.min(8, depthFor(parent, next) + 1);
  }

  return [...byId.values()]
    .map((category) => ({ ...category, depth: depthFor(category) }))
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
}

function categoryPathIds(category, byId) {
  const ids = [];
  const seen = new Set();
  let current = category;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ids.unshift(current.id);
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return ids;
}

function chooseCategory(previous, candidate) {
  if (!candidate?.id) return previous || null;
  if (!previous?.id) return candidate;
  const previousDepth = Number(previous.depth || 0);
  const candidateDepth = Number(candidate.depth || 0);
  if (candidateDepth > previousDepth) return candidate;
  if (candidateDepth < previousDepth) return previous;
  return String(candidate.id).localeCompare(String(previous.id)) < 0 ? candidate : previous;
}

async function productId(sourceId) {
  const digest = await sha256Hex(`${PUBLIC_ID_NAMESPACE}|yupoo|${cleanText(sourceId)}`);
  return `p_${digest.slice(0, 20)}`;
}

async function listingFingerprint(item) {
  const digest = await sha256Hex(
    JSON.stringify({
      v: LISTING_FINGERPRINT_VERSION,
      title: cleanText(item.sourceTitle),
      cover: cleanText(item.coverSourceUrl),
      signal: cleanText(item.listingSignal),
      imageCountHint: Number.isFinite(item.imageCountHint) ? item.imageCountHint : null
    })
  );
  return digest;
}

async function scanListing({ baseUrl, maxPages, category, sourceHost, fetchImpl, albums }) {
  const seen = new Set();
  let naturalEnd = false;
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = pagedUrl(baseUrl, page);
    const html = await fetchHtml(pageUrl, { sourceHost, fetchImpl });
    const rows = parseYupooListingHtml(html, pageUrl);
    pages += 1;
    let newInScope = 0;
    for (const row of rows) {
      if (seen.has(row.sourceId)) continue;
      seen.add(row.sourceId);
      newInScope += 1;
      const previous = albums.get(row.sourceId);
      albums.set(row.sourceId, {
        ...(previous || row),
        ...row,
        category: chooseCategory(previous?.category || null, category || null)
      });
    }
    if (rows.length === 0 || newInScope === 0) {
      naturalEnd = true;
      break;
    }
  }
  if (!naturalEnd && pages >= maxPages) throw new Error('supplier_listing_page_limit');
  return pages;
}

function categoryRoute(category, sourceUrl) {
  const url = new URL(category.sourceUrl || `/categories/${category.id}`, sourceUrl);
  return url.href;
}

async function resolveCategoryRoute(category, sourceUrl, sourceHost, fetchImpl) {
  const normal = categoryRoute(category, sourceUrl);
  try {
    await fetchHtml(normal, { sourceHost, fetchImpl });
    return normal;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  const candidate = new URL(normal);
  candidate.searchParams.set('isSubCate', 'true');
  return candidate.href;
}

function syntheticSingleCategory(sourceUrl, html) {
  const id = categoryIdFromHref(sourceUrl);
  if (!id) return null;
  const $ = cheerio.load(html);
  const title = cleanText($('title').first().text()).replace(/\s*\|.*$/, '') || `Category ${id}`;
  return { id, name: title, parentId: null, sourceUrl, depth: 0 };
}

export async function scanYupooListingIndex(
  sourceUrl,
  {
    fetchImpl = fetch,
    maxRootPages = 500,
    maxCategoryPages = 500,
    categoryConcurrency = 4
  } = {}
) {
  const root = assertYupooUrl(sourceUrl);
  const sourceHost = root.hostname;
  const pathname = root.pathname.replace(/\/+$/, '') || '/';
  const isCategoryScope = /\/categories\/\d+$/i.test(pathname);
  const albums = new Map();
  let taxonomy = [];
  let rootPages = 0;
  let categoryPages = 0;

  if (isCategoryScope) {
    const resolved = root.href;
    const firstHtml = await fetchHtml(resolved, { sourceHost, fetchImpl });
    const category = syntheticSingleCategory(resolved, firstHtml);
    rootPages = await scanListing({
      baseUrl: resolved,
      maxPages: maxRootPages,
      category,
      sourceHost,
      fetchImpl,
      albums
    });
    taxonomy = category ? [category] : [];
  } else {
    const taxonomyHtml = await fetchHtml(root.href, { sourceHost, fetchImpl });
    taxonomy = normalizeTaxonomy(categoriesFromHtml(taxonomyHtml, root.href));
    rootPages = await scanListing({
      baseUrl: root.href,
      maxPages: maxRootPages,
      category: null,
      sourceHost,
      fetchImpl,
      albums
    });

    const queue = new PQueue({ concurrency: Math.max(1, Math.min(8, categoryConcurrency)) });
    await Promise.all(
      [...taxonomy]
        .sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id))
        .map((category) =>
          queue.add(async () => {
            const route = await resolveCategoryRoute(category, root.href, sourceHost, fetchImpl);
            categoryPages += await scanListing({
              baseUrl: route,
              maxPages: maxCategoryPages,
              category,
              sourceHost,
              fetchImpl,
              albums
            });
          })
        )
    );
  }

  const taxonomyById = new Map(taxonomy.map((category) => [String(category.id), category]));
  const items = [];
  for (const item of [...albums.values()].sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)))) {
    const category = item.category || null;
    items.push({
      albumSourceId: String(item.sourceId),
      publicProductId: await productId(item.sourceId),
      sourceUrl: item.sourceUrl,
      sourceTitle: cleanText(item.sourceTitle),
      sourceCategoryId: category?.id ? String(category.id) : null,
      sourceCategoryPath: category ? categoryPathIds(category, taxonomyById) : [],
      coverSourceUrl: item.coverSourceUrl || null,
      imageCountHint: Number.isFinite(item.imageCountHint) ? item.imageCountHint : null,
      listingFingerprint: await listingFingerprint(item)
    });
  }

  return {
    complete: true,
    sourceKind: isCategoryScope ? 'category' : 'catalog',
    items,
    taxonomy,
    stats: {
      albums: items.length,
      categories: taxonomy.length,
      rootPages,
      categoryPages
    }
  };
}
