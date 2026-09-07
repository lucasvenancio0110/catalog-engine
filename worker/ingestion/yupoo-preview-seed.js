import { sha256Hex } from '../runtime-identity.js';
import { parseYupooListingHtml } from './yupoo-listing.js';

const YUPOO_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;
const PHOTO_HOST = 'photo.yupoo.com';
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 24;
const HARD_MAX_ITEMS = 48;
const DEFAULT_DEADLINE_MS = 4_500;
const MAX_REDIRECTS = 3;
const LISTING_FINGERPRINT_VERSION = 2;
const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const CONSTRUCTION_MEDIA_NAMESPACE = 'catalog-engine:construction-media:v1';
const SEED_NAMESPACE = 'catalog-engine:construction-seed:v1';

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function boundedItems(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_ITEMS;
  return Math.min(HARD_MAX_ITEMS, parsed);
}

function assertYupooUrl(value, expectedHost = null) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !YUPOO_HOST_PATTERN.test(url.hostname)
  ) {
    throw new Error('supplier_url_rejected');
  }
  if (expectedHost && url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error('supplier_redirect_rejected');
  }
  return url;
}

function assertCoverUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hostname.toLowerCase() !== PHOTO_HOST
  ) {
    throw new Error('supplier_media_url_rejected');
  }
  return url.href;
}

async function fetchFirstListingPage(
  sourceUrl,
  { fetchImpl = fetch, deadlineMs = DEFAULT_DEADLINE_MS } = {}
) {
  const source = assertYupooUrl(sourceUrl);
  const sourceHost = source.hostname;
  const startedAt = Date.now();
  let current = source.href;
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    const remaining = Math.max(1, Number(deadlineMs) - (Date.now() - startedAt));
    if (remaining <= 1) throw new Error('supplier_preview_seed_deadline');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response;
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          accept: 'text/html,application/xhtml+xml'
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('supplier_preview_seed_deadline');
      throw error;
    } finally {
      clearTimeout(timer);
    }

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
      throw new Error(`supplier_transient_${response.status}`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`supplier_http_${response.status}`);
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
    return { html, pageUrl: current };
  }

  throw new Error('supplier_redirect_limit');
}

async function publicProductId(sourceId) {
  const digest = await sha256Hex(`${PUBLIC_ID_NAMESPACE}|yupoo|${cleanText(sourceId)}`);
  return `p_${digest.slice(0, 20)}`;
}

async function listingFingerprint(item) {
  return sha256Hex(
    JSON.stringify({
      v: LISTING_FINGERPRINT_VERSION,
      title: cleanText(item.sourceTitle),
      cover: cleanText(item.coverSourceUrl),
      signal: cleanText(item.listingSignal),
      imageCountHint: Number.isFinite(item.imageCountHint) ? item.imageCountHint : null
    })
  );
}

async function constructionMediaId(sourceUrl) {
  const digest = await sha256Hex(`${CONSTRUCTION_MEDIA_NAMESPACE}|yupoo|${sourceUrl}`);
  return `cm_${digest.slice(0, 20)}`;
}

export async function constructionItemFromYupooListingRow(row) {
  const coverSourceUrl = assertCoverUrl(row.coverSourceUrl);
  return {
    productId: await publicProductId(row.sourceId),
    title: cleanText(row.sourceTitle || 'Produto').slice(0, 160) || 'Produto',
    listingFingerprint: await listingFingerprint(row),
    sourceItemUrl: assertYupooUrl(row.sourceUrl).href,
    cover: coverSourceUrl
      ? {
          mediaId: await constructionMediaId(coverSourceUrl),
          sourceUrl: coverSourceUrl
        }
      : null,
    categories: []
  };
}

export async function constructionSeedFromYupooListingRows(
  sourceUrl,
  rows,
  { maxItems = HARD_MAX_ITEMS, now = () => new Date() } = {}
) {
  const source = assertYupooUrl(sourceUrl);
  if (!Array.isArray(rows) || !rows.length) throw new Error('supplier_preview_seed_empty');
  const items = [];
  for (const row of rows.slice(0, boundedItems(maxItems))) {
    items.push(await constructionItemFromYupooListingRow(row));
  }
  if (!items.length) throw new Error('supplier_preview_seed_empty');

  const seedDigest = await sha256Hex(
    `${SEED_NAMESPACE}|yupoo|${source.href}|${items
      .map((item) => `${item.productId}:${item.listingFingerprint}`)
      .join('|')}`
  );
  const observed = now();
  const observedAt =
    observed instanceof Date ? observed.toISOString() : new Date(observed).toISOString();

  return {
    seedId: `cs_${seedDigest.slice(0, 20)}`,
    readiness: 'indexed',
    complete: false,
    observedAt,
    items
  };
}

export async function previewSeedYupoo(
  sourceUrl,
  {
    fetchImpl = fetch,
    maxItems = DEFAULT_MAX_ITEMS,
    deadlineMs = DEFAULT_DEADLINE_MS,
    now = () => new Date()
  } = {}
) {
  const source = assertYupooUrl(sourceUrl);
  const { html, pageUrl } = await fetchFirstListingPage(source.href, { fetchImpl, deadlineMs });
  const rows = parseYupooListingHtml(html, pageUrl).slice(0, boundedItems(maxItems));
  return constructionSeedFromYupooListingRows(source.href, rows, { maxItems, now });
}

export const yupooPreviewSeedContract = Object.freeze({
  defaultMaxItems: DEFAULT_MAX_ITEMS,
  hardMaxItems: HARD_MAX_ITEMS,
  defaultDeadlineMs: DEFAULT_DEADLINE_MS,
  maxHtmlBytes: MAX_HTML_BYTES
});
