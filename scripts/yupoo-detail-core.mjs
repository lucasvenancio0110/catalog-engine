import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { classifyCatalogItem } from './full-import-core.mjs';

const provider = 'yupoo';
const timeoutMs = 30_000;
const requestAttempts = 4;
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};
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
    .trim();
}

function safeDescription(value = '') {
  const text = clean(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:WhatsApp|WeChat)\s*[:+]?\s*[\w+-]+/gi, '')
    .trim();
  if (/Wholesale/i.test(text)) return '';
  return text.slice(0, 600);
}

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try { return new URL(value, base).href; } catch { return null; }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchWithRetry(url, referer = '') {
  let lastError;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { ...headers, ...(referer ? { referer } : {}) },
        redirect: 'follow',
        signal: controller.signal
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < requestAttempts) await sleep(attempt * 1250);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function imageGroupKey(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'photo.yupoo.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 3) return null;
    return `${parsed.hostname}/${segments.slice(0, -1).join('/')}`;
  } catch {
    return null;
  }
}

function filename(url) {
  try { return new URL(url).pathname.split('/').pop() || ''; } catch { return ''; }
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

function extractSourceImages($, albumUrl) {
  const groups = new Map();
  const attributes = [['data-origin-src', 100], ['data-original', 90], ['data-src', 70], ['data-lazy', 60], ['src', 20]];
  $('img').each((_, image) => {
    for (const [attribute, priority] of attributes) {
      const url = absolute(albumUrl, $(image).attr(attribute));
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
  return [...groups.values()].filter((group) => group.full?.url).map((group) => ({
    sourceUrl: group.full.url,
    displaySourceUrl: group.display?.url || group.full.url,
    thumbnailSourceUrl: group.thumbnail?.url || group.display?.url || group.full.url
  }));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function mediaId(sourceImageUrl) {
  return `m_${sha256(`catalog-engine:remote-media:v1|${provider}|${sourceImageUrl}`).slice(0, 20)}`;
}

export function detailFingerprint(detail = {}) {
  const payload = {
    name: clean(detail.name),
    description: clean(detail.description),
    images: (detail.images || []).map((image) => image.sourceUrl)
  };
  return sha256(`catalog-engine:album-detail:v1|${JSON.stringify(payload)}`);
}

export async function fetchYupooAlbumDetail(albumUrl, sourceCatalogUrl = '') {
  const html = await fetchWithRetry(albumUrl, sourceCatalogUrl);
  const $ = cheerio.load(html);
  const metaTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const h1 = clean($('h1').first().text());
  const rawDescription = $('meta[name="description"]').attr('content')?.trim() || clean($('[class*="description"], [class*="desc"]').first().text()) || '';
  const name = cleanTitle(metaTitle || h1 || 'Produto');
  const description = safeDescription(rawDescription);
  const images = extractSourceImages($, albumUrl);
  const classification = classifyCatalogItem({ name, description, sourceImageCount: images.length });
  return { name, description, images, classification, detailFingerprint: detailFingerprint({ name, description, images }) };
}
