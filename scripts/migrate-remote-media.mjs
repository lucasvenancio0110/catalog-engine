import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { publicProductId } from './catalog-sync.mjs';

const provider = 'yupoo';
const sourceUrl = process.argv[2] || process.env.SOURCE_URL || 'https://zhouchangliang.x.yupoo.com/albums/';
const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const sqlPath = process.env.MEDIA_SQL_OUT || '/tmp/media-sources.sql';
const summaryPath = process.env.MEDIA_SUMMARY_OUT || '/tmp/media-proxy-summary.json';
const maxPages = Math.max(1, Math.min(20, Number(process.env.MAX_PAGES || 10)));
const timeoutMs = 30_000;
const requestAttempts = 4;

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

const derivativeNames = /^(?:small|medium|big|square|thumb|thumbnail|tiny)\.[a-z0-9]+$/i;

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
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  $('a[href*="/albums/"]').each((_, el) => {
    const href = normalizeAlbumUrl(baseUrl, $(el).attr('href'));
    const match = href?.match(/\/albums\/(\d+)/);
    if (!href || !match) return;
    found.set(match[1], { sourceId: match[1], url: href });
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

function fullQualityScore(url, sourcePriority = 0) {
  const filename = imageFilename(url);
  let score = sourcePriority;
  if (!derivativeNames.test(filename)) score += 1200;
  else if (/^big\./i.test(filename)) score += 1000;
  else if (/^medium\./i.test(filename)) score += 800;
  else if (/^small\./i.test(filename)) score += 500;
  else if (/^square\./i.test(filename)) score += 300;
  else score += 200;
  return score;
}

function displayQualityScore(url, sourcePriority = 0) {
  const filename = imageFilename(url);
  let score = sourcePriority;
  if (/^big\./i.test(filename)) score += 1200;
  else if (/^medium\./i.test(filename)) score += 1100;
  else if (!derivativeNames.test(filename)) score += 1000;
  else if (/^small\./i.test(filename)) score += 700;
  else if (/^square\./i.test(filename)) score += 500;
  else score += 300;
  return score;
}

function thumbnailQualityScore(url, sourcePriority = 0) {
  const filename = imageFilename(url);
  let score = sourcePriority;
  if (/^small\./i.test(filename)) score += 1200;
  else if (/^medium\./i.test(filename)) score += 1100;
  else if (/^square\./i.test(filename)) score += 1000;
  else if (/^(?:thumb|thumbnail|tiny)\./i.test(filename)) score += 950;
  else if (/^big\./i.test(filename)) score += 700;
  else if (!derivativeNames.test(filename)) score += 500;
  else score += 400;
  return score;
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

  $('img').each((_, img) => {
    for (const [attribute, priority] of attributes) {
      const candidate = $(img).attr(attribute);
      const url = absolute(albumUrl, candidate);
      if (!url || /avatar|logo|icon|qrcode/i.test(url)) continue;
      const key = imageGroupKey(url);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, {});
      const group = groups.get(key);
      keepBest(group, 'full', url, fullQualityScore(url, priority));
      keepBest(group, 'display', url, displayQualityScore(url, priority));
      keepBest(group, 'thumbnail', url, thumbnailQualityScore(url, priority));
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

assertSource(sourceUrl);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const products = Array.isArray(catalog.products) ? catalog.products : [];
if (!products.length) throw new Error('Catálogo público sem produtos para migrar.');

const productById = new Map(products.map((product) => [String(product.id), product]));
for (const productId of productById.keys()) {
  if (!/^p_[a-f0-9]{20}$/.test(productId)) throw new Error(`Produto público com ID inválido: ${productId}`);
}

const matchedAlbums = new Map();
for (let page = 1; page <= maxPages && matchedAlbums.size < productById.size; page += 1) {
  const url = pagedUrl(sourceUrl, page);
  const html = await getHtml(url);
  const albums = extractAlbumLinks(html, url);
  let newMatches = 0;

  for (const album of albums) {
    const publicId = publicProductId(provider, album.sourceId);
    if (!productById.has(publicId) || matchedAlbums.has(publicId)) continue;
    matchedAlbums.set(publicId, { ...album, publicId });
    newMatches += 1;
  }

  console.log(`Página ${page}: ${albums.length} álbuns, ${newMatches} correspondências novas, ${matchedAlbums.size}/${productById.size} produtos localizados.`);
  if (!albums.length) break;
}

if (matchedAlbums.size !== productById.size) {
  const missing = [...productById.keys()].filter((id) => !matchedAlbums.has(id));
  throw new Error(`Migração abortada: ${missing.length} produto(s) do catálogo atual não foram reencontrados na fonte dentro de ${maxPages} página(s).`);
}

const queue = new PQueue({ concurrency: 4, intervalCap: 6, interval: 1000, timeout: 45_000 });
const remoteByProduct = new Map();
await Promise.all(
  [...matchedAlbums.values()].map((album) =>
    queue.add(async () => {
      const html = await getHtml(album.url, sourceUrl);
      const sourceImages = extractSourceImages(html, album.url);
      if (!sourceImages.length) throw new Error(`Produto ${album.publicId} não retornou imagens remotas válidas.`);
      remoteByProduct.set(album.publicId, { album, sourceImages });
      console.log(`${album.publicId}: ${sourceImages.length} imagem(ns) remota(s) encontrada(s).`);
    })
  )
);

// Wrangler's remote D1 file executor applies the uploaded SQL safely as a batch.
// Explicit BEGIN/COMMIT statements are intentionally avoided because remote D1
// rejects user-managed SQL transactions in this execution path.
const sql = ['PRAGMA foreign_keys = ON;'];
const allMedia = [];

for (const product of products) {
  const publicId = String(product.id);
  const remote = remoteByProduct.get(publicId);
  if (!remote) throw new Error(`Dados remotos ausentes para ${publicId}.`);

  sql.push(`DELETE FROM product_media WHERE product_id = ${sqlString(publicId)};`);

  const descriptors = remote.sourceImages.map((sourceImage, position) => {
    const id = mediaId(sourceImage.sourceUrl);
    const viewUrl = `/media/${id}/view`;
    const thumbnailUrl = `/media/${id}/thumb`;
    const downloadUrl = `/media/${id}`;

    sql.push(
      `INSERT INTO media_sources (media_id, provider, source_url, display_source_url, thumbnail_source_url, referer_url, active, updated_at) VALUES (` +
      `${sqlString(id)}, ${sqlString(provider)}, ${sqlString(sourceImage.sourceUrl)}, ${sqlString(sourceImage.displaySourceUrl)}, ${sqlString(sourceImage.thumbnailSourceUrl)}, ${sqlString(remote.album.url)}, 1, CURRENT_TIMESTAMP) ` +
      `ON CONFLICT(media_id) DO UPDATE SET provider=excluded.provider, source_url=excluded.source_url, display_source_url=excluded.display_source_url, thumbnail_source_url=excluded.thumbnail_source_url, referer_url=excluded.referer_url, active=1, updated_at=CURRENT_TIMESTAMP;`
    );
    sql.push(
      `INSERT INTO product_media (product_id, media_id, position, updated_at) VALUES (` +
      `${sqlString(publicId)}, ${sqlString(id)}, ${position}, CURRENT_TIMESTAMP) ` +
      `ON CONFLICT(product_id, position) DO UPDATE SET media_id=excluded.media_id, updated_at=CURRENT_TIMESTAMP;`
    );

    allMedia.push(id);
    return {
      id,
      url: viewUrl,
      thumbnailUrl,
      downloadUrl,
      storage: 'edge-proxy'
    };
  });

  product.media = descriptors;
  product.images = descriptors.map((item) => item.url);
  product.imageCount = descriptors.length;
}

sql.push(`DELETE FROM media_sources WHERE provider = ${sqlString(provider)} AND media_id NOT IN (SELECT media_id FROM product_media);`);

catalog.generatedAt = new Date().toISOString();
catalog.mediaVersion = 3;
catalog.storage = {
  mode: 'edge-proxy',
  publicBase: '/media',
  variants: {
    view: 'view',
    thumbnail: 'thumb',
    download: 'original'
  }
};
catalog.mediaStats = {
  storageMode: 'edge-proxy',
  logicalImages: allMedia.length,
  uniqueImages: new Set(allMedia).size,
  proxiedImages: new Set(allMedia).size,
  optimizedDisplayVariants: allMedia.length,
  optimizedThumbnailVariants: allMedia.length,
  repositoryImageBytes: 0
};

const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(serialized)) {
  throw new Error('White-label gate: a saída pública contém hostname da fonte.');
}
if (products.some((product) => product.images.some((url) => !/^\/media\/m_[a-f0-9]{20}\/view$/.test(url)))) {
  throw new Error('White-label gate: URL pública de mídia inválida após migração.');
}

await writeFile(catalogPath, serialized, 'utf8');
await writeFile(sqlPath, `${sql.join('\n')}\n`, 'utf8');
await writeFile(
  summaryPath,
  `${JSON.stringify({
    ok: true,
    products: products.length,
    logicalImages: allMedia.length,
    uniqueImages: new Set(allMedia).size,
    mediaVersion: catalog.mediaVersion,
    storageMode: catalog.storage.mode,
    publicBase: catalog.storage.publicBase,
    variants: catalog.storage.variants
  }, null, 2)}\n`,
  'utf8'
);

console.log(`Migração preparada: ${products.length} produtos, ${allMedia.length} referências de mídia, ${new Set(allMedia).size} mídias únicas com variantes rápidas. Nenhuma imagem foi baixada.`);
