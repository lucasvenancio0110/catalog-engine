import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { publicCategoryId, publicProductId } from './catalog-sync.mjs';
import {
  buildUsedPublicTaxonomy,
  categoryPathFor,
  chooseCategoryAssignment,
  classifyCatalogItem
} from './full-import-core.mjs';
import { scanYupooTaxonomy } from './yupoo-taxonomy.mjs';
import { resolveYupooSourceUrl } from './yupoo-source-resolver.mjs';

const provider = 'yupoo';
const sourceUrl = process.argv[2] || process.env.SOURCE_URL;
const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const storePath = process.env.STORE_PATH || 'data/store.json';
const sqlDir = process.env.CATALOG_SQL_DIR || '/tmp/catalog-engine-full-sql';
const summaryPath = process.env.IMPORT_SUMMARY_OUT || '/tmp/catalog-engine-full-summary.json';
const maxRootPages = Math.max(1, Number(process.env.MAX_ROOT_PAGES || 500));
const maxCategoryPages = Math.max(1, Number(process.env.MAX_CATEGORY_PAGES || 500));
const maxProducts = Math.max(0, Number(process.env.MAX_PRODUCTS || 0));
const sqlChunkStatements = Math.max(250, Number(process.env.SQL_CHUNK_STATEMENTS || 1200));
const timeoutMs = 30_000;
const requestAttempts = 4;

if (!sourceUrl) throw new Error('SOURCE_URL é obrigatório para a importação completa.');

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};
const derivativeNames = /^(?:small|medium|big|square|thumb|thumbnail|tiny)\.[a-z0-9]+$/i;

const mediaSchema = z.object({
  id: z.string().regex(/^m_[a-f0-9]{20}$/),
  url: z.string().regex(/^\/media\/m_[a-f0-9]{20}\/view$/),
  thumbnailUrl: z.string().regex(/^\/media\/m_[a-f0-9]{20}\/thumb$/),
  downloadUrl: z.string().regex(/^\/media\/m_[a-f0-9]{20}$/),
  storage: z.literal('edge-proxy')
});
const productSchema = z.object({
  id: z.string().regex(/^p_[a-f0-9]{20}$/),
  name: z.string().min(1),
  category: z.string().min(1),
  categoryId: z.string().regex(/^c_[a-f0-9]{20}$/),
  categoryPathIds: z.array(z.string().regex(/^c_[a-f0-9]{20}$/)).min(1),
  description: z.string(),
  images: z.array(z.string().regex(/^\/media\/m_[a-f0-9]{20}\/view$/)).min(1),
  media: z.array(mediaSchema).min(1),
  imageCount: z.number().int().positive(),
  entityType: z.literal('product')
});
const categorySchema = z.object({
  id: z.string().regex(/^c_[a-f0-9]{20}$/),
  type: z.literal('category'),
  name: z.string().min(1),
  parentId: z.string().regex(/^c_[a-f0-9]{20}$/).nullable(),
  childIds: z.array(z.string().regex(/^c_[a-f0-9]{20}$/)),
  depth: z.number().int().nonnegative()
});
const catalogSchema = z.object({
  schemaVersion: z.number().int().min(6),
  mediaVersion: z.literal(3),
  taxonomyVersion: z.literal(1),
  generatedAt: z.string().min(1),
  store: z.record(z.string(), z.unknown()),
  taxonomy: z.array(categorySchema).min(1),
  products: z.array(productSchema).min(1),
  storage: z.object({
    mode: z.literal('edge-proxy'),
    publicBase: z.literal('/media'),
    variants: z.object({
      view: z.literal('view'),
      thumbnail: z.literal('thumb'),
      download: z.literal('original')
    })
  })
}).passthrough();

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function cleanTitle(value = '') {
  return cleanText(value)
    .replace(/\s*\|\s*álbum\s*\|.*$/i, '')
    .replace(/\s*\|\s*album\s*\|.*$/i, '')
    .replace(/\s*\|\s*Wholesale.*$/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
}

function safeDescription(value = '') {
  const text = cleanText(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:WhatsApp|WeChat)\s*[:+]?\s*[\w+-]+/gi, '')
    .trim();
  if (/Wholesale/i.test(text)) return '';
  return text.slice(0, 600);
}

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function assertSource(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.x.yupoo.com')) {
    throw new Error('A fonte precisa ser um catálogo Yupoo público em HTTPS (*.x.yupoo.com).');
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

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'follow',
        signal: controller.signal
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < requestAttempts) await sleep(attempt * 1250);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function getHtml(url, referer = '') {
  const response = await fetchWithRetry(url, {
    headers: {
      ...headers,
      ...(referer ? { referer } : {})
    }
  });
  return response.text();
}

function extractAlbumLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href*="/albums/"]').each((_, element) => {
    const href = normalizeAlbumUrl(baseUrl, $(element).attr('href'));
    const match = href?.match(/\/albums\/(\d+)/);
    if (!href || !match) return;
    const hintedName = cleanText($(element).text()) || cleanText($(element).find('img').first().attr('alt'));
    found.set(match[1], { sourceId: match[1], url: href, hintedName });
  });
  return [...found.values()];
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

function imageFilename(url) {
  try {
    return new URL(url).pathname.split('/').pop() || '';
  } catch {
    return '';
  }
}

function scoreFull(url, priority) {
  const filename = imageFilename(url);
  if (!derivativeNames.test(filename)) return priority + 1200;
  if (/^big\./i.test(filename)) return priority + 1000;
  if (/^medium\./i.test(filename)) return priority + 800;
  if (/^small\./i.test(filename)) return priority + 500;
  if (/^square\./i.test(filename)) return priority + 300;
  return priority + 200;
}

function scoreDisplay(url, priority) {
  const filename = imageFilename(url);
  if (/^big\./i.test(filename)) return priority + 1200;
  if (/^medium\./i.test(filename)) return priority + 1100;
  if (!derivativeNames.test(filename)) return priority + 1000;
  if (/^small\./i.test(filename)) return priority + 700;
  if (/^square\./i.test(filename)) return priority + 500;
  return priority + 300;
}

function scoreThumb(url, priority) {
  const filename = imageFilename(url);
  if (/^small\./i.test(filename)) return priority + 1200;
  if (/^medium\./i.test(filename)) return priority + 1100;
  if (/^square\./i.test(filename)) return priority + 1000;
  if (/^(?:thumb|thumbnail|tiny)\./i.test(filename)) return priority + 950;
  if (/^big\./i.test(filename)) return priority + 700;
  if (!derivativeNames.test(filename)) return priority + 500;
  return priority + 400;
}

function keepBest(group, key, url, score) {
  const previous = group[key];
  if (!previous || previous.score < score) group[key] = { url, score };
}

function extractSourceImages(html, albumUrl) {
  const $ = cheerio.load(html);
  const groups = new Map();
  const attributes = [
    ['data-origin-src', 100],
    ['data-original', 90],
    ['data-src', 70],
    ['data-lazy', 60],
    ['src', 20]
  ];

  $('img').each((_, image) => {
    for (const [attribute, priority] of attributes) {
      const candidate = $(image).attr(attribute);
      const url = absolute(albumUrl, candidate);
      if (!url || /avatar|logo|icon|qrcode/i.test(url)) continue;
      const key = imageGroupKey(url);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, {});
      const group = groups.get(key);
      keepBest(group, 'full', url, scoreFull(url, priority));
      keepBest(group, 'display', url, scoreDisplay(url, priority));
      keepBest(group, 'thumbnail', url, scoreThumb(url, priority));
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

function albumMeta(html, album) {
  const $ = cheerio.load(html);
  const metaTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const h1 = cleanText($('h1').first().text());
  const rawDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    cleanText($('[class*="description"], [class*="desc"]').first().text()) ||
    '';
  const name = cleanTitle(metaTitle || h1 || album.hintedName || `Produto ${album.sourceId}`);
  const description = safeDescription(rawDescription);
  const images = extractSourceImages(html, album.url);
  return {
    name,
    description,
    images,
    classification: classifyCatalogItem({ name, description, sourceImageCount: images.length })
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mediaId(sourceImageUrl) {
  return `m_${sha256(`catalog-engine:remote-media:v1|${provider}|${sourceImageUrl}`).slice(0, 20)}`;
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function registerAlbum(albums, candidate, category = null, rootOrder = null) {
  const sourceId = String(candidate.sourceId);
  const previous = albums.get(sourceId) || {
    sourceId,
    url: candidate.url,
    hintedName: candidate.hintedName || '',
    category: null,
    rootOrder: null
  };
  previous.url = candidate.url || previous.url;
  previous.hintedName = previous.hintedName || candidate.hintedName || '';
  if (rootOrder !== null && previous.rootOrder === null) previous.rootOrder = rootOrder;
  if (category) previous.category = chooseCategoryAssignment(previous.category, category);
  albums.set(sourceId, previous);
}

async function scanListing({ baseUrl, maxPages, albums, category = null, rootOrderCounter = null }) {
  const scopeSeen = new Set();
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = pagedUrl(baseUrl, page);
    const html = await getHtml(url, sourceUrl);
    const pageAlbums = extractAlbumLinks(html, url);
    pages += 1;
    let newOnPage = 0;

    for (const album of pageAlbums) {
      if (scopeSeen.has(album.sourceId)) continue;
      scopeSeen.add(album.sourceId);
      newOnPage += 1;
      const rootOrder = rootOrderCounter ? rootOrderCounter.value++ : null;
      registerAlbum(albums, album, category, rootOrder);
      if (maxProducts > 0 && albums.size >= maxProducts) {
        return { pages, naturalEnd: false, limited: true };
      }
    }

    console.log(`${category ? `Categoria ${category.name}` : 'Catálogo geral'} · página ${page}: ${pageAlbums.length} álbuns, ${newOnPage} novos no escopo, ${albums.size} únicos globais.`);
    if (pageAlbums.length === 0 || newOnPage === 0) return { pages, naturalEnd: true, limited: false };
  }
  return { pages, naturalEnd: false, limited: false };
}

async function writeSqlChunks(statements) {
  await rm(sqlDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true });
  const files = [];
  for (let index = 0; index < statements.length; index += sqlChunkStatements) {
    const chunk = statements.slice(index, index + sqlChunkStatements);
    const path = resolve(sqlDir, `${String(files.length + 1).padStart(4, '0')}.sql`);
    await writeFile(path, `PRAGMA foreign_keys = ON;\n${chunk.join('\n')}\n`, 'utf8');
    files.push(path);
  }
  return files;
}

assertSource(sourceUrl);
const taxonomyScan = await scanYupooTaxonomy(sourceUrl);
const rawTaxonomy = taxonomyScan.categories;
const albums = new Map();
const rootOrderCounter = { value: 0 };

console.log(`Taxonomia Yupoo: ${taxonomyScan.stats.total} categorias, ${taxonomyScan.stats.nested} aninhadas.`);
const rootResult = await scanListing({
  baseUrl: sourceUrl,
  maxPages: maxRootPages,
  albums,
  rootOrderCounter
});
if (!rootResult.naturalEnd && !rootResult.limited && rootResult.pages >= maxRootPages) {
  throw new Error(`Varredura geral atingiu MAX_ROOT_PAGES=${maxRootPages} antes do fim natural.`);
}

if (!(maxProducts > 0 && albums.size >= maxProducts)) {
  const categoryQueue = new PQueue({ concurrency: 4, intervalCap: 6, interval: 1000, timeout: 900_000 });
  const categoriesBySpecificity = [...rawTaxonomy].sort((a, b) => (b.depth || 0) - (a.depth || 0));
  await Promise.all(
    categoriesBySpecificity.map((category) =>
      categoryQueue.add(async () => {
        const resolvedCategoryUrl = await resolveYupooSourceUrl(category.sourceUrl);
        const result = await scanListing({
          baseUrl: resolvedCategoryUrl,
          maxPages: maxCategoryPages,
          albums,
          category
        });
        if (!result.naturalEnd && !result.limited && result.pages >= maxCategoryPages) {
          throw new Error(`Categoria ${category.name} atingiu MAX_CATEGORY_PAGES=${maxCategoryPages} antes do fim natural.`);
        }
      })
    )
  );
}

const albumList = [...albums.values()]
  .sort((a, b) => (a.rootOrder ?? Number.MAX_SAFE_INTEGER) - (b.rootOrder ?? Number.MAX_SAFE_INTEGER))
  .slice(0, maxProducts > 0 ? maxProducts : undefined);
console.log(`Descoberta concluída: ${albumList.length} álbuns únicos. Lendo detalhes sem baixar imagens...`);

const detailQueue = new PQueue({ concurrency: 6, intervalCap: 9, interval: 1000, timeout: 180_000 });
const extracted = [];
let skippedNavigation = 0;
let skippedInformation = 0;
let failedAlbums = 0;

await Promise.all(
  albumList.map((album, index) =>
    detailQueue.add(async () => {
      try {
        const html = await getHtml(album.url, sourceUrl);
        const meta = albumMeta(html, album);
        if (meta.classification.entityType === 'navigation') {
          skippedNavigation += 1;
          return;
        }
        if (meta.classification.entityType === 'information') {
          skippedInformation += 1;
          return;
        }
        if (!meta.name || !meta.images.length) {
          failedAlbums += 1;
          console.warn(`Ignorado sem mídia válida: ${album.sourceId}`);
          return;
        }
        extracted.push({ ...album, ...meta, sourceOrder: index });
        if (extracted.length % 100 === 0) console.log(`${extracted.length} produtos comerciais preparados...`);
      } catch (error) {
        failedAlbums += 1;
        console.warn(`Falha no álbum ${album.sourceId}: ${error?.message || error}`);
      }
    })
  )
);

if (failedAlbums > 0) {
  throw new Error(`Importação completa abortada: ${failedAlbums} álbum(ns) falharam. Reexecute para não publicar catálogo parcial.`);
}
if (!extracted.length) throw new Error('Nenhum produto comercial foi extraído.');
extracted.sort((a, b) => a.sourceOrder - b.sourceOrder);

const uncategorizedSourceId = '__catalog_engine_uncategorized__';
const usedSourceCategoryIds = new Set(extracted.map((item) => item.category?.id).filter(Boolean).map(String));
if (extracted.some((item) => !item.category?.id)) usedSourceCategoryIds.add(uncategorizedSourceId);
const taxonomyInput = [...rawTaxonomy];
if (usedSourceCategoryIds.has(uncategorizedSourceId)) {
  taxonomyInput.push({ id: uncategorizedSourceId, name: 'Outros', parentId: null, childIds: [], depth: 0 });
}
const publicTaxonomy = buildUsedPublicTaxonomy({
  provider,
  rawTaxonomy: taxonomyInput,
  usedSourceCategoryIds: [...usedSourceCategoryIds]
});
const publicRawById = publicTaxonomy.rawById;

const statements = ['DELETE FROM product_media;'];
const allMedia = [];
const products = extracted.map((item) => {
  const publicId = publicProductId(provider, item.sourceId);
  const sourceCategoryId = item.category?.id ? String(item.category.id) : uncategorizedSourceId;
  const sourceCategory = publicRawById.get(sourceCategoryId);
  const categoryId = publicCategoryId(provider, sourceCategoryId);
  const categoryPathIds = categoryPathFor(sourceCategoryId, publicRawById, provider);

  const media = item.images.map((sourceImage, position) => {
    const id = mediaId(sourceImage.sourceUrl);
    allMedia.push(id);
    statements.push(
      `INSERT INTO media_sources (media_id, provider, source_url, display_source_url, thumbnail_source_url, referer_url, active, updated_at) VALUES (` +
      `${sqlString(id)}, ${sqlString(provider)}, ${sqlString(sourceImage.sourceUrl)}, ${sqlString(sourceImage.displaySourceUrl)}, ${sqlString(sourceImage.thumbnailSourceUrl)}, ${sqlString(item.url)}, 1, CURRENT_TIMESTAMP) ` +
      `ON CONFLICT(media_id) DO UPDATE SET provider=excluded.provider, source_url=excluded.source_url, display_source_url=excluded.display_source_url, thumbnail_source_url=excluded.thumbnail_source_url, referer_url=excluded.referer_url, active=1, updated_at=CURRENT_TIMESTAMP;`
    );
    statements.push(
      `INSERT INTO product_media (product_id, media_id, position, updated_at) VALUES (` +
      `${sqlString(publicId)}, ${sqlString(id)}, ${position}, CURRENT_TIMESTAMP) ` +
      `ON CONFLICT(product_id, position) DO UPDATE SET media_id=excluded.media_id, updated_at=CURRENT_TIMESTAMP;`
    );
    return {
      id,
      url: `/media/${id}/view`,
      thumbnailUrl: `/media/${id}/thumb`,
      downloadUrl: `/media/${id}`,
      storage: 'edge-proxy'
    };
  });

  return {
    id: publicId,
    name: item.name,
    category: sourceCategory?.name || 'Outros',
    categoryId,
    categoryPathIds,
    description: item.description,
    images: media.map((entry) => entry.url),
    media,
    imageCount: media.length,
    entityType: 'product'
  };
});
statements.push(`DELETE FROM media_sources WHERE provider = ${sqlString(provider)} AND media_id NOT IN (SELECT media_id FROM product_media);`);

const previousCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
let store = previousCatalog.store || {};
try {
  store = JSON.parse(await readFile(storePath, 'utf8'));
} catch {
  // Existing public store settings remain authoritative when store.json is absent.
}

const usedCategoryIds = new Set(products.flatMap((product) => product.categoryPathIds));
const taxonomy = publicTaxonomy.taxonomy.filter((category) => usedCategoryIds.has(category.id));
const catalog = {
  schemaVersion: 6,
  generatedAt: new Date().toISOString(),
  store,
  taxonomyVersion: 1,
  taxonomy,
  taxonomyStats: {
    total: taxonomy.length,
    roots: taxonomy.filter((category) => !category.parentId).length,
    nested: taxonomy.filter((category) => category.parentId).length,
    maxDepth: taxonomy.reduce((max, category) => Math.max(max, category.depth || 0), 0),
    used: usedCategoryIds.size
  },
  mediaVersion: 3,
  storage: {
    mode: 'edge-proxy',
    publicBase: '/media',
    variants: { view: 'view', thumbnail: 'thumb', download: 'original' }
  },
  mediaStats: {
    storageMode: 'edge-proxy',
    logicalImages: allMedia.length,
    uniqueImages: new Set(allMedia).size,
    proxiedImages: new Set(allMedia).size,
    optimizedDisplayVariants: allMedia.length,
    optimizedThumbnailVariants: allMedia.length,
    repositoryImageBytes: 0
  },
  import: {
    mode: 'complete-catalog',
    products: products.length,
    discoveredAlbums: albumList.length,
    skippedNavigation,
    skippedInformation,
    failedAlbums: 0,
    rootPagesScanned: rootResult.pages,
    taxonomyCategoriesScanned: rawTaxonomy.length
  },
  stats: { products: products.length, photos: allMedia.length },
  products
};

const validated = catalogSchema.parse(catalog);
const serialized = `${JSON.stringify(validated, null, 2)}\n`;
if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(serialized)) {
  throw new Error('White-label gate: hostname do fornecedor apareceu no catálogo público.');
}
if (serialized.includes(sourceUrl)) throw new Error('White-label gate: URL da fonte apareceu no catálogo público.');

await writeFile(catalogPath, serialized, 'utf8');
const sqlFiles = await writeSqlChunks(statements);
const summary = {
  ok: true,
  mode: 'complete-catalog',
  discoveredAlbums: albumList.length,
  products: products.length,
  skippedNavigation,
  skippedInformation,
  taxonomy: catalog.taxonomyStats,
  media: catalog.mediaStats,
  sqlChunks: sqlFiles.length,
  rootPagesScanned: rootResult.pages
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
