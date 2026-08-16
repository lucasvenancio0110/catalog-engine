import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { scanYupooTaxonomy } from './yupoo-taxonomy.mjs';
import { resolveYupooSourceUrl } from './yupoo-source-resolver.mjs';
import { publicCategoryId, publicProductId } from './catalog-sync.mjs';

const sourceInput = process.argv[2] || process.env.SOURCE_URL || 'https://zhouchangliang.x.yupoo.com/albums/';
const maxPagesPerScope = Number(process.env.MAX_PAGES_PER_SCOPE || 120);
const concurrency = Math.max(1, Math.min(4, Number(process.env.INVENTORY_CONCURRENCY || 2)));
const timeoutMs = 30_000;
const attempts = 4;
const provider = 'yupoo';

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function albumId(href = '') {
  return href.match(/\/albums\/(\d+)/)?.[1] || null;
}

function pageUrl(base, page) {
  const url = new URL(base);
  url.searchParams.set('page', String(page));
  return url.href;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1400);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function extractAlbums(html, baseUrl) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href*="/albums/"]').each((_, el) => {
    const raw = $(el).attr('href');
    if (!raw) return;
    let href;
    try { href = new URL(raw, baseUrl).href; } catch { return; }
    const id = albumId(href);
    if (!id) return;
    const title = clean($(el).text()) || clean($(el).find('img').first().attr('alt')) || `Álbum ${id}`;
    const previous = found.get(id);
    if (!previous || title.length > previous.title.length) found.set(id, { id, title });
  });
  return [...found.values()];
}

async function scanScope(scope) {
  const resolved = await resolveYupooSourceUrl(scope.url);
  const seen = new Map();
  let pagesScanned = 0;
  let stopReason = 'max-pages';
  const errors = [];

  for (let page = 1; page <= maxPagesPerScope; page++) {
    const url = pageUrl(resolved, page);
    let html;
    try {
      html = await fetchText(url);
    } catch (error) {
      errors.push({ page, message: error.message });
      stopReason = 'request-error';
      break;
    }

    pagesScanned += 1;
    const albums = extractAlbums(html, url);
    const before = seen.size;
    for (const album of albums) seen.set(album.id, album);
    const added = seen.size - before;

    console.log(`[inventory] ${scope.name} page=${page} albums=${albums.length} new=${added} total=${seen.size}`);

    if (albums.length === 0) {
      stopReason = 'empty-page';
      break;
    }
    if (page > 1 && added === 0) {
      stopReason = 'repeated-page';
      break;
    }
    await sleep(220);
  }

  return {
    ...scope,
    resolvedUrl: resolved,
    pagesScanned,
    stopReason,
    complete: ['empty-page', 'repeated-page'].includes(stopReason) && errors.length === 0,
    errors,
    albums: [...seen.values()]
  };
}

async function readMediaBaseline() {
  try {
    const manifest = JSON.parse(await readFile('data/media-manifest.json', 'utf8'));
    const stats = manifest.stats || {};
    const logical = Number(stats.logicalImages || 0);
    const unique = Number(stats.uniqueImages || logical || 1);
    return {
      sampleProducts: 40,
      logicalImages: logical,
      uniqueImages: unique,
      avgImagesPerProduct: logical ? logical / 40 : 2,
      avgOriginalBytesPerImage: unique ? Number(stats.uniqueOriginalBytes || 0) / unique : 600_000,
      avgWebBytesPerImage: unique ? Number(stats.webBytes || 0) / unique : 200_000,
      avgThumbBytesPerImage: unique ? Number(stats.thumbnailBytes || 0) / unique : 25_000
    };
  } catch {
    return {
      sampleProducts: 0,
      logicalImages: 0,
      uniqueImages: 0,
      avgImagesPerProduct: 2,
      avgOriginalBytesPerImage: 600_000,
      avgWebBytesPerImage: 200_000,
      avgThumbBytesPerImage: 25_000
    };
  }
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function gb(bytes) {
  return Number((bytes / 1024 / 1024 / 1024).toFixed(2));
}

async function main() {
  const source = new URL(sourceInput);
  if (!source.hostname.endsWith('.x.yupoo.com')) throw new Error('Fonte precisa ser Yupoo público (*.x.yupoo.com).');

  const taxonomy = await scanYupooTaxonomy(source.href);
  const scopes = [
    {
      kind: 'catalog',
      sourceId: 'catalog',
      publicId: 'catalog',
      name: 'Catálogo geral',
      parentSourceId: null,
      depth: 0,
      url: new URL('/albums/', source.origin).href
    },
    ...taxonomy.categories.map((category) => ({
      kind: 'category',
      sourceId: category.id,
      publicId: publicCategoryId(provider, category.id),
      name: category.name,
      parentSourceId: category.parentId || null,
      depth: category.depth || 0,
      url: category.sourceUrl
    }))
  ];

  console.log(`[inventory] taxonomy=${taxonomy.categories.length} scopes=${scopes.length} concurrency=${concurrency}`);

  const queue = new PQueue({ concurrency, timeout: 15 * 60_000, throwOnTimeout: true });
  const results = await Promise.all(scopes.map((scope) => queue.add(() => scanScope(scope), { id: `${scope.kind}:${scope.sourceId}` })));

  const products = new Map();
  const scopeMembership = new Map();
  for (const scope of results) {
    for (const album of scope.albums) {
      const publicId = publicProductId(provider, album.id);
      const existing = products.get(publicId) || {
        publicId,
        sourceId: album.id,
        title: album.title,
        categories: []
      };
      if (album.title.length > existing.title.length) existing.title = album.title;
      if (scope.kind === 'category' && !existing.categories.includes(scope.publicId)) existing.categories.push(scope.publicId);
      products.set(publicId, existing);
      if (!scopeMembership.has(scope.publicId)) scopeMembership.set(scope.publicId, new Set());
      scopeMembership.get(scope.publicId).add(publicId);
    }
  }

  const baseline = await readMediaBaseline();
  const productCount = products.size;
  const estimatedImages = Math.ceil(productCount * baseline.avgImagesPerProduct);
  const estimatedOriginalBytes = estimatedImages * baseline.avgOriginalBytesPerImage;
  const estimatedWebBytes = estimatedImages * baseline.avgWebBytesPerImage;
  const estimatedThumbBytes = estimatedImages * baseline.avgThumbBytesPerImage;

  const categoryStats = taxonomy.categories.map((category) => {
    const id = publicCategoryId(provider, category.id);
    return {
      id,
      name: category.name,
      parentId: category.parentId ? publicCategoryId(provider, category.parentId) : null,
      depth: category.depth || 0,
      uniqueProductsObserved: scopeMembership.get(id)?.size || 0
    };
  });

  const incompleteScopes = results.filter((scope) => !scope.complete).map((scope) => ({
    kind: scope.kind,
    name: scope.name,
    publicId: scope.publicId,
    pagesScanned: scope.pagesScanned,
    stopReason: scope.stopReason,
    errors: scope.errors
  }));

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceType: 'yupoo',
    taxonomy: taxonomy.stats,
    scopes: {
      total: results.length,
      complete: results.filter((scope) => scope.complete).length,
      incomplete: incompleteScopes.length
    },
    products: {
      uniqueCandidates: productCount,
      estimatedImages
    },
    mediaEstimate: {
      sample: baseline,
      originalGB: gb(estimatedOriginalBytes),
      webGB: gb(estimatedWebBytes),
      thumbnailsMB: mb(estimatedThumbBytes),
      publishedWithOriginalsGB: gb(estimatedOriginalBytes + estimatedWebBytes + estimatedThumbBytes),
      publishedWebAndThumbGB: gb(estimatedWebBytes + estimatedThumbBytes)
    },
    categoryStats: categoryStats.sort((a, b) => b.uniqueProductsObserved - a.uniqueProductsObserved || a.name.localeCompare(b.name)),
    incompleteScopes
  };

  const privateInventory = {
    ...summary,
    products: [...products.values()],
    scopes: results.map((scope) => ({
      kind: scope.kind,
      sourceId: scope.sourceId,
      publicId: scope.publicId,
      name: scope.name,
      parentSourceId: scope.parentSourceId,
      depth: scope.depth,
      sourceUrl: scope.url,
      resolvedUrl: scope.resolvedUrl,
      pagesScanned: scope.pagesScanned,
      stopReason: scope.stopReason,
      complete: scope.complete,
      errors: scope.errors,
      albumSourceIds: scope.albums.map((album) => album.id)
    }))
  };

  await mkdir('tmp', { recursive: true });
  await mkdir(dirname('data/full-inventory-summary.json'), { recursive: true });
  await writeFile('tmp/full-inventory-private.json', `${JSON.stringify(privateInventory, null, 2)}\n`, 'utf8');
  await writeFile('data/full-inventory-summary.json', `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: incompleteScopes.length === 0,
    taxonomy: taxonomy.stats,
    scopes: summary.scopes,
    uniqueCandidates: productCount,
    estimatedImages,
    mediaEstimate: summary.mediaEstimate,
    topCategories: summary.categoryStats.slice(0, 15)
  }, null, 2));

  if (incompleteScopes.length) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
