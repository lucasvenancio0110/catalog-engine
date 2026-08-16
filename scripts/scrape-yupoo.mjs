import * as cheerio from 'cheerio';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

const sourceUrl = process.argv[2] || 'https://zhouchangliang.x.yupoo.com/albums/';
const maxAlbums = Number(process.env.MAX_ALBUMS || 50);
const timeoutMs = 30000;
const requestAttempts = 4;

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

const derivativeNames = /^(?:small|medium|big|square|thumb|thumbnail|tiny)\.[a-z0-9]+$/i;
const infoPattern = /\b(?:tutorial|how\s+to|notice|announcement|contact|order\s+guide|purchase\s+guide|size\s+chart|payment|shipping|freight|instruction|instructions)\b/i;
const taxonomyPattern = /^(?:product\s+category(?:\s+search)?|other\s+football\s+leagues?|(?:france\s+)?ligue\s*1|(?:italy\s+)?serie\s*a|(?:fa\s+)?premier\s+league|(?:spain\s+)?la\s+liga|bundesliga(?:\s+jersey)?|national\s+team(?:\s+jersey)?|player\s+version(?:\s+jersey)?|women(?:'s)?\s+jersey|kids?.*football(?:\s+team)?|retro\s+jersey|windbreaker|mls(?:\s+major\s+league)?(?:\s+jersey)?|nba(?:\s*\([^)]*\))?|nfl\s*-\s*mlb\s*-\s*nhl|adult\s+training\s+suit|brazil\s+campeonato\s+brasileiro.*)$/i;

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try { return new URL(value, base).href; } catch { return null; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function assertYupooSource(value) {
  const url = new URL(value);
  if (!url.hostname.endsWith('.x.yupoo.com')) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }
}

function normalizeAlbumUrl(baseUrl, value) {
  const href = absolute(baseUrl, value);
  if (!href) return null;

  try {
    const url = new URL(href);
    if (!url.searchParams.has('uid')) url.searchParams.set('uid', '1');
    return url.href;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, attempts = requestAttempts) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = attempt * 1500;
      console.warn(`Tentativa ${attempt}/${attempts} falhou em ${url}: ${error.message}. Nova tentativa em ${delay} ms.`);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function getHtml(url) {
  const response = await fetchWithRetry(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return await response.text();
}

function extractCategories(html, baseUrl) {
  const $ = cheerio.load(html);
  const found = new Map();

  $('a[href*="/categories/"]').each((_, el) => {
    const href = absolute(baseUrl, $(el).attr('href'));
    const match = href?.match(/\/categories\/(\d+)/);
    if (!href || !match) return;

    const name = cleanText($(el).text()) || cleanText($(el).find('img').first().attr('alt'));
    if (!name || /^\d+$/.test(name)) return;

    found.set(match[1], {
      id: match[1],
      type: 'category',
      name,
      sourceUrl: href
    });
  });

  return found;
}

function extractAlbumLinks(html, baseUrl, categories) {
  const $ = cheerio.load(html);
  const found = new Map();

  $('a[href*="/albums/"]').each((_, el) => {
    const href = normalizeAlbumUrl(baseUrl, $(el).attr('href'));
    if (!href) return;
    const match = href.match(/\/albums\/(\d+)/);
    if (!match) return;

    const url = new URL(href);
    const sourceCategoryId = url.searchParams.get('referrercate') || null;
    const text = cleanText($(el).text());
    const imageAlt = cleanText($(el).find('img').first().attr('alt'));

    found.set(match[1], {
      id: match[1],
      url: href,
      hintedName: text || imageAlt || `Álbum ${match[1]}`,
      sourceCategoryId,
      sourceCategoryName: sourceCategoryId ? categories.get(sourceCategoryId)?.name || '' : ''
    });
  });

  return [...found.values()];
}

function cleanTitle(value = '') {
  return value
    .replace(/\s*\|\s*álbum\s*\|.*$/i, '')
    .replace(/\s*\|\s*album\s*\|.*$/i, '')
    .replace(/\s*\|\s*Wholesale.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(value = '') {
  const normalized = cleanText(value);
  if (/Wholesale|WhatsApp\+?\d+/i.test(normalized)) return '';
  return normalized;
}

function imageGroupKey(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'photo.yupoo.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 3) return null;
    return `${parsed.hostname}/${segments.slice(0, -1).join('/')}`;
  } catch {
    return null;
  }
}

function imageQualityScore(url, sourcePriority = 0) {
  try {
    const filename = new URL(url).pathname.split('/').pop() || '';
    let score = sourcePriority;
    if (!derivativeNames.test(filename)) score += 1000;
    else if (/^big\./i.test(filename)) score += 800;
    else if (/^medium\./i.test(filename)) score += 600;
    else if (/^small\./i.test(filename)) score += 400;
    else if (/^square\./i.test(filename)) score += 200;
    return score;
  } catch {
    return sourcePriority;
  }
}

function extractImageGroups($, albumUrl) {
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

      if (!groups.has(key)) groups.set(key, new Map());
      const group = groups.get(key);
      const score = imageQualityScore(url, priority);
      const previous = group.get(url);
      if (!previous || previous.score < score) group.set(url, { url, score });
    }
  });

  return [...groups.values()].map((group) =>
    [...group.values()].sort((a, b) => b.score - a.score)
  );
}

function resolveSourceCategory($, album) {
  if (album.sourceCategoryId) {
    let resolved = '';
    $('a[href*="/categories/"]').each((_, el) => {
      if (resolved) return;
      const href = $(el).attr('href') || '';
      if (!href.includes(`/categories/${album.sourceCategoryId}`)) return;
      const text = cleanText($(el).text());
      if (text) resolved = text;
    });
    if (resolved) return resolved;
  }

  const breadcrumb = cleanText($('[class*="breadcrumb"] a').last().text());
  return breadcrumb || album.sourceCategoryName || 'Catálogo';
}

function classifyItem({ name, description, sourceImageCount }) {
  const cleanName = cleanText(name);
  const hasSeason = /\b(?:19|20)?\d{2}[\/-](?:19|20)?\d{2}\b|\b20\d{2}\b/.test(cleanName);
  const hasSize = /\b(?:size\s*)?(?:xs|s|m|l|xl|xxl|xxxl|\d{2})\s*[-–]\s*(?:xs|s|m|l|xl|xxl|xxxl|\d{2,3})\b/i.test(cleanName);
  const hasProductSignal = hasSeason || hasSize || /\b(?:home|away|third|goalkeeper|match|player\s+version|kids?\s+kit|crop)\b/i.test(cleanName);

  if (infoPattern.test(`${cleanName} ${description}`)) {
    return { entityType: 'information', confidence: 'high', reason: 'informational-title' };
  }

  if (taxonomyPattern.test(cleanName) && !hasProductSignal && sourceImageCount <= 2) {
    return { entityType: 'navigation', confidence: 'high', reason: 'taxonomy-shortcut' };
  }

  if (!hasProductSignal && sourceImageCount <= 1 && /\b(?:league|liga|jersey|team|training|retro|women|kids|category)\b/i.test(cleanName)) {
    return { entityType: 'navigation', confidence: 'medium', reason: 'generic-single-image' };
  }

  return { entityType: 'product', confidence: hasProductSignal || sourceImageCount > 1 ? 'high' : 'medium', reason: 'commercial-item' };
}

function extractProductMeta(html, album) {
  const $ = cheerio.load(html);
  const metaTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const h1 = cleanText($('h1').first().text());
  const rawTitle = metaTitle || h1 || album.hintedName;

  const rawDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    cleanText($('[class*="description"], [class*="desc"]').first().text()) ||
    '';

  const name = cleanTitle(rawTitle) || cleanTitle(album.hintedName) || `Produto ${album.id}`;
  const description = cleanDescription(rawDescription);
  const imageGroups = extractImageGroups($, album.url);
  const sourceCategoryName = resolveSourceCategory($, album);
  const classification = classifyItem({ name, description, sourceImageCount: imageGroups.length });

  return {
    id: album.id,
    name,
    category: sourceCategoryName,
    description,
    sourceUrl: album.url,
    sourceCategoryId: album.sourceCategoryId,
    sourceCategoryName,
    sourceImageCount: imageGroups.length,
    ...classification,
    imageGroups
  };
}

function extensionFor(url, contentType) {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (/^\.(?:jpe?g|png|webp|gif)$/i.test(fromUrl)) return fromUrl === '.jpeg' ? '.jpg' : fromUrl;
  if (/image\/png/i.test(contentType)) return '.png';
  if (/image\/webp/i.test(contentType)) return '.webp';
  if (/image\/gif/i.test(contentType)) return '.gif';
  return '.jpg';
}

async function downloadBestImage(candidates, album, photoIndex) {
  for (const candidate of candidates) {
    try {
      const response = await fetchWithRetry(candidate.url, {
        headers: {
          ...headers,
          referer: album.url,
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      }, 3);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) throw new Error(`conteúdo inesperado: ${contentType || 'sem content-type'}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('imagem vazia');

      const extension = extensionFor(candidate.url, contentType);
      const relativePath = `assets/catalog/${album.id}/${String(photoIndex + 1).padStart(2, '0')}${extension}`;
      await mkdir(dirname(relativePath), { recursive: true });
      await writeFile(relativePath, bytes);

      return {
        localUrl: `./${relativePath}`,
        sourceUrl: candidate.url,
        bytes: bytes.length
      };
    } catch (error) {
      console.warn(`  ↳ imagem ${photoIndex + 1}: falhou ${candidate.url} (${error.message})`);
    }
  }

  return null;
}

async function main() {
  assertYupooSource(sourceUrl);
  console.log(`Analisando: ${sourceUrl}`);

  await rm('assets/catalog', { recursive: true, force: true });

  const indexHtml = await getHtml(sourceUrl);
  const categoryMap = extractCategories(indexHtml, sourceUrl);
  const albums = extractAlbumLinks(indexHtml, sourceUrl, categoryMap).slice(0, maxAlbums);

  if (!albums.length) {
    throw new Error('Nenhum álbum foi encontrado. O layout do Yupoo pode ter mudado ou a página pode exigir outro método de leitura.');
  }

  console.log(`${albums.length} itens candidatos selecionados.`);
  const items = [];
  let totalPhotos = 0;
  let totalBytes = 0;

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    try {
      const html = await getHtml(album.url);
      const meta = extractProductMeta(html, album);
      const images = [];
      const sourceImages = [];

      if (meta.entityType === 'product') {
        for (let photoIndex = 0; photoIndex < meta.imageGroups.length; photoIndex++) {
          const downloaded = await downloadBestImage(meta.imageGroups[photoIndex], album, photoIndex);
          if (!downloaded) continue;
          images.push(downloaded.localUrl);
          sourceImages.push(downloaded.sourceUrl);
          totalPhotos += 1;
          totalBytes += downloaded.bytes;
        }
      }

      const { imageGroups, ...itemMeta } = meta;
      items.push({ ...itemMeta, images, sourceImages, imageCount: images.length });
      console.log(`[${i + 1}/${albums.length}] ${meta.entityType.toUpperCase()} | ${meta.name} | ${images.length}/${meta.sourceImageCount} foto(s)`);
    } catch (error) {
      console.warn(`[${i + 1}/${albums.length}] falhou ${album.url}: ${error.message}`);
    }
  }

  const products = items.filter((item) => item.entityType === 'product');
  const navigation = items.filter((item) => item.entityType === 'navigation');
  const information = items.filter((item) => item.entityType === 'information');

  const output = {
    schemaVersion: 3,
    source: sourceUrl,
    generatedAt: new Date().toISOString(),
    taxonomy: [...categoryMap.values()],
    stats: {
      candidates: items.length,
      products: products.length,
      navigation: navigation.length,
      information: information.length,
      photos: totalPhotos,
      downloadedBytes: totalBytes
    },
    products,
    navigation,
    information,
    items
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/catalog.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Concluído: ${products.length} produtos, ${navigation.length} atalhos, ${information.length} informativos, ${totalPhotos} fotos HD, ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
