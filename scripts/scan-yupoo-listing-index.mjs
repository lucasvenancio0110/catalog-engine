import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { listingFingerprint } from './incremental-sync-core.mjs';
import { scanYupooTaxonomy } from './yupoo-taxonomy.mjs';
import { resolveYupooSourceUrl } from './yupoo-source-resolver.mjs';

const sourceUrl = process.argv[2] || process.env.SOURCE_URL;
const outputPath = process.env.SUPPLIER_INDEX_OUT || '/tmp/catalog-engine-current-index.json';
const maxRootPages = Math.max(1, Number(process.env.MAX_ROOT_PAGES || 500));
const maxCategoryPages = Math.max(1, Number(process.env.MAX_CATEGORY_PAGES || 500));
const timeoutMs = 30_000;
const requestAttempts = 4;

if (!sourceUrl) throw new Error('SOURCE_URL é obrigatório.');

const source = new URL(sourceUrl);
if (source.protocol !== 'https:' || !source.hostname.endsWith('.x.yupoo.com')) {
  throw new Error('A fonte precisa ser um catálogo Yupoo público em HTTPS (*.x.yupoo.com).');
}

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try { return new URL(value, base).href; } catch { return null; }
}

function normalizeAlbumUrl(baseUrl, value) {
  const href = absolute(baseUrl, value);
  if (!href) return null;
  try {
    const url = new URL(href);
    if (!url.hostname.endsWith('.x.yupoo.com')) return null;
    if (!url.searchParams.has('uid')) url.searchParams.set('uid', '1');
    return url.href;
  } catch {
    return null;
  }
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

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
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

function categoryPathIds(categoryId, byId) {
  if (!categoryId) return [];
  const output = [];
  const seen = new Set();
  let current = byId.get(String(categoryId));
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    output.unshift(String(current.id));
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return output;
}

function imageCountHint(text = '') {
  const patterns = [
    /(?:photos?|pics?|images?)\s*[:：]?\s*(\d{1,4})/i,
    /(\d{1,4})\s*(?:photos?|pics?|images?)/i,
    /(?:图片|照片)\s*[:：]?\s*(\d{1,4})/i
  ];
  for (const pattern of patterns) {
    const match = clean(text).match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractAlbumCards(html, baseUrl, category = null, rawById = new Map()) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href*="/albums/"]').each((_, element) => {
    const href = normalizeAlbumUrl(baseUrl, $(element).attr('href'));
    const match = href?.match(/\/albums\/(\d+)/);
    if (!href || !match) return;
    const sourceId = match[1];
    const container = $(element).closest('li, [class*="album"], [class*="showalbum"], [class*="product"]');
    const scope = container.length ? container : $(element).parent();
    const image = scope.find('img').first();
    const title = clean($(element).text()) || clean(image.attr('alt')) || clean(scope.find('[class*="title"]').first().text());
    const coverUrl = absolute(baseUrl, image.attr('data-origin-src') || image.attr('data-original') || image.attr('data-src') || image.attr('src')) || '';
    const signalText = clean(scope.text()).slice(0, 800);
    const signalAttrs = [
      scope.attr('data-id'),
      scope.attr('data-time'),
      scope.attr('data-update-time'),
      scope.attr('data-count'),
      image.attr('data-origin-src'),
      image.attr('data-original'),
      image.attr('data-src')
    ].filter(Boolean).join('|');
    const categoryId = category?.id ? String(category.id) : '';
    const pathIds = categoryPathIds(categoryId, rawById);
    const entry = {
      sourceId,
      sourceUrl: href,
      title,
      categoryId,
      categoryPathIds: pathIds,
      categoryDepth: Number(category?.depth || 0),
      coverUrl,
      imageCountHint: imageCountHint(signalText),
      listingSignal: clean(`${signalText}|${signalAttrs}`)
    };
    entry.listingFingerprint = listingFingerprint(entry);
    found.set(sourceId, entry);
  });
  return [...found.values()];
}

function chooseEntry(previous, candidate) {
  if (!previous) return candidate;
  if ((candidate.categoryDepth || 0) > (previous.categoryDepth || 0)) return candidate;
  if ((candidate.categoryDepth || 0) === (previous.categoryDepth || 0) && candidate.categoryId && !previous.categoryId) return candidate;
  return {
    ...previous,
    title: previous.title || candidate.title,
    coverUrl: previous.coverUrl || candidate.coverUrl,
    imageCountHint: previous.imageCountHint ?? candidate.imageCountHint,
    listingSignal: previous.listingSignal.length >= candidate.listingSignal.length ? previous.listingSignal : candidate.listingSignal
  };
}

async function scanScope({ baseUrl, maxPages, category, rawById, albums }) {
  let pages = 0;
  const seen = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const url = pagedUrl(baseUrl, page);
    const html = await fetchText(url);
    const entries = extractAlbumCards(html, url, category, rawById);
    pages += 1;
    let newInScope = 0;
    for (const entry of entries) {
      if (seen.has(entry.sourceId)) continue;
      seen.add(entry.sourceId);
      newInScope += 1;
      albums.set(entry.sourceId, chooseEntry(albums.get(entry.sourceId), entry));
    }
    console.log(`${category ? `Categoria ${category.name}` : 'Catálogo'} · página ${page}: ${entries.length} cards, ${newInScope} novos no escopo.`);
    if (entries.length === 0 || newInScope === 0) return { pages, complete: true };
  }
  return { pages, complete: false };
}

const startedAt = new Date().toISOString();
const taxonomyScan = await scanYupooTaxonomy(sourceUrl);
const rawTaxonomy = taxonomyScan.categories;
const rawById = new Map(rawTaxonomy.map((category) => [String(category.id), category]));
const albums = new Map();

const rootResult = await scanScope({ baseUrl: sourceUrl, maxPages: maxRootPages, category: null, rawById, albums });
if (!rootResult.complete) throw new Error(`Scan incremental abortado: catálogo geral atingiu MAX_ROOT_PAGES=${maxRootPages}.`);

const queue = new PQueue({ concurrency: 4, intervalCap: 6, interval: 1000, timeout: 900_000 });
const categoryResults = [];
await Promise.all(
  [...rawTaxonomy]
    .sort((a, b) => (b.depth || 0) - (a.depth || 0))
    .map((category) => queue.add(async () => {
      const resolved = await resolveYupooSourceUrl(category.sourceUrl);
      const result = await scanScope({ baseUrl: resolved, maxPages: maxCategoryPages, category, rawById, albums });
      categoryResults.push({ categoryId: String(category.id), ...result });
      if (!result.complete) throw new Error(`Scan incremental abortado: categoria ${category.name} atingiu MAX_CATEGORY_PAGES=${maxCategoryPages}.`);
    }))
);

const entries = [...albums.values()].map((entry) => ({ ...entry, listingFingerprint: listingFingerprint(entry) })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
const output = {
  schemaVersion: 1,
  provider: 'yupoo',
  sourceUrl,
  startedAt,
  finishedAt: new Date().toISOString(),
  complete: true,
  stats: {
    albums: entries.length,
    rootPages: rootResult.pages,
    taxonomyCategories: rawTaxonomy.length,
    categoryPages: categoryResults.reduce((sum, item) => sum + item.pages, 0)
  },
  taxonomy: rawTaxonomy,
  albums: entries
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, complete: true, ...output.stats, outputPath }, null, 2));
