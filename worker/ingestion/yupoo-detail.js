import * as cheerio from 'cheerio';
import { sha256Hex } from '../runtime-identity.js';

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ATTEMPTS = 4;
const YUPOO_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i;
const derivativeNames = /^(?:small|medium|big|square|thumb|thumbnail|tiny)\.[a-z0-9]+$/i;

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function cleanTitle(value = '') {
  return clean(value)
    .replace(/\s*\|\s*álbum\s*\|.*$/i, '')
    .replace(/\s*\|\s*album\s*\|.*$/i, '')
    .replace(/\s*\|\s*Wholesale.*$/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()
    .slice(0, 240);
}

function safeDescription(value = '') {
  const text = clean(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:WhatsApp|WeChat|Telegram)\s*[:+]?\s*[\w+@.-]+/gi, '')
    .replace(/\b(?:www\.)?[a-z0-9.-]+\.(?:com|net|org|cn)(?:\/\S*)?/gi, '')
    .trim();
  if (/Wholesale/i.test(text)) return '';
  return text.slice(0, 600);
}

function assertSupplierUrl(value, expectedHost = null) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !YUPOO_HOST_PATTERN.test(url.hostname)) {
    throw new Error('supplier_url_rejected');
  }
  if (expectedHost && url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error('supplier_redirect_rejected');
  }
  return url;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAlbumHtml(albumUrl, { sourceHost, fetchImpl = fetch } = {}) {
  let current = assertSupplierUrl(albumUrl, sourceHost).href;
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
          current = assertSupplierUrl(new URL(location, current).href, sourceHost).href;
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
        const declared = Number(response.headers.get('content-length') || 0);
        if (declared > MAX_HTML_BYTES) {
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
    if (attempt < REQUEST_ATTEMPTS) await sleep(Math.min(5000, 500 * 2 ** (attempt - 1)));
  }
  throw lastError || new Error('supplier_fetch_failed');
}

function photoUrl(base, value) {
  const href = absolute(base, value);
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'photo.yupoo.com') return null;
    return url.href;
  } catch {
    return null;
  }
}

function imageGroupKey(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname !== 'photo.yupoo.com' || segments.length < 3) return null;
    return `${parsed.hostname}/${segments.slice(0, -1).join('/')}`;
  } catch {
    return null;
  }
}

function filename(url) {
  try {
    return new URL(url).pathname.split('/').pop() || '';
  } catch {
    return '';
  }
}

function score(url, priority, mode) {
  const name = filename(url);
  if (mode === 'full') {
    if (!derivativeNames.test(name)) return priority + 1200;
    if (/^big\./i.test(name)) return priority + 1000;
    if (/^medium\./i.test(name)) return priority + 800;
    if (/^small\./i.test(name)) return priority + 500;
    return priority + 300;
  }
  if (mode === 'display') {
    if (/^big\./i.test(name)) return priority + 1200;
    if (/^medium\./i.test(name)) return priority + 1100;
    if (!derivativeNames.test(name)) return priority + 1000;
    if (/^small\./i.test(name)) return priority + 700;
    return priority + 400;
  }
  if (/^small\./i.test(name)) return priority + 1200;
  if (/^medium\./i.test(name)) return priority + 1100;
  if (/^square\./i.test(name)) return priority + 1000;
  if (/^(?:thumb|thumbnail|tiny)\./i.test(name)) return priority + 950;
  if (/^big\./i.test(name)) return priority + 700;
  if (!derivativeNames.test(name)) return priority + 500;
  return priority + 400;
}

function keepBest(group, key, url, value) {
  if (!group[key] || group[key].score < value) group[key] = { url, score: value };
}

function extractImages($, albumUrl) {
  const groups = new Map();
  const attributes = [
    ['data-origin-src', 100],
    ['data-original', 90],
    ['data-src', 70],
    ['data-lazy', 60],
    ['src', 20]
  ];
  $('img').each((_index, image) => {
    for (const [attribute, priority] of attributes) {
      const url = photoUrl(albumUrl, $(image).attr(attribute));
      if (!url || /avatar|logo|icon|qrcode/i.test(url)) continue;
      const key = imageGroupKey(url);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, {});
      const group = groups.get(key);
      keepBest(group, 'full', url, score(url, priority, 'full'));
      keepBest(group, 'display', url, score(url, priority, 'display'));
      keepBest(group, 'thumbnail', url, score(url, priority, 'thumb'));
    }
  });
  return [...groups.values()]
    .filter((group) => group.full?.url)
    .map((group) => ({
      sourceUrl: group.full.url,
      displaySourceUrl: group.display?.url || group.full.url,
      thumbnailSourceUrl: group.thumbnail?.url || group.display?.url || group.full.url
    }));
}

export function classifyImportedAlbum({ name = '', description = '', imageCount = 0 } = {}) {
  const text = clean(`${name} ${description}`);
  const informational = /\b(?:tutorial|how\s+to|notice|announcement|contact|call\s+me|facebook\s+group|logistics|order\s+guide|purchase\s+guide|size\s+(?:chart|table)|payment|shipping|freight|instruction|instructions)\b/i;
  const productSignal = /\b(?:home|away|third|goalkeeper|match|player\s+version|kids?\s+kit|shirt|jersey|training|tracksuit|jacket|shorts?|retro|20\d{2})\b/i;
  if (informational.test(text)) return { entityType: 'information', confidence: 'high' };
  if (!productSignal.test(text) && imageCount <= 1 && /\b(?:league|liga|team|category|size)\b/i.test(text)) {
    return { entityType: 'navigation', confidence: 'medium' };
  }
  return { entityType: 'product', confidence: productSignal.test(text) || imageCount > 1 ? 'high' : 'medium' };
}

export async function mediaId(sourceImageUrl) {
  const digest = await sha256Hex(`catalog-engine:remote-media:v1|yupoo|${sourceImageUrl}`);
  return `m_${digest.slice(0, 20)}`;
}

export async function detailFingerprint(detail = {}) {
  const payload = {
    name: clean(detail.name),
    description: clean(detail.description),
    images: (detail.images || []).map((image) => image.sourceUrl)
  };
  return sha256Hex(`catalog-engine:album-detail:v1|${JSON.stringify(payload)}`);
}

export async function parseYupooAlbumHtml(html, albumUrl) {
  const $ = cheerio.load(html);
  const metaTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const h1 = clean($('h1').first().text());
  const rawDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    clean($('[class*="description"], [class*="desc"]').first().text()) ||
    '';
  const name = cleanTitle(metaTitle || h1 || 'Produto');
  const description = safeDescription(rawDescription);
  const images = extractImages($, albumUrl);
  const classification = classifyImportedAlbum({ name, description, imageCount: images.length });
  const fingerprint = await detailFingerprint({ name, description, images });
  return { name, description, images, classification, detailFingerprint: fingerprint };
}

export async function fetchYupooAlbumDetailWorker(
  albumUrl,
  sourceCatalogUrl,
  { fetchImpl = fetch } = {}
) {
  const sourceHost = assertSupplierUrl(sourceCatalogUrl).hostname;
  const album = assertSupplierUrl(albumUrl, sourceHost);
  if (!/\/albums\/\d+/i.test(album.pathname)) throw new Error('supplier_album_url_rejected');
  const html = await fetchAlbumHtml(album.href, { sourceHost, fetchImpl });
  return parseYupooAlbumHtml(html, album.href);
}
