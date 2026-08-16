import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';

const sourceUrl = process.argv[2] || 'https://zhouchangliang.x.yupoo.com/albums/';
const maxAlbums = Number(process.env.MAX_ALBUMS || 20);
const timeoutMs = 20000;

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

function absolute(base, value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  try { return new URL(value, base).href; } catch { return null; }
}

async function getHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractAlbumLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const found = new Map();

  $('a[href*="/albums/"]').each((_, el) => {
    const href = absolute(baseUrl, $(el).attr('href'));
    if (!href) return;
    const match = href.match(/\/albums\/(\d+)/);
    if (!match) return;

    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const imageAlt = $(el).find('img').first().attr('alt')?.trim();
    found.set(match[1], {
      id: match[1],
      url: href.split('?')[0],
      hintedName: text || imageAlt || `Álbum ${match[1]}`
    });
  });

  return [...found.values()];
}

function extractProduct(html, album) {
  const $ = cheerio.load(html);
  const metaTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const title = metaTitle || h1 || album.hintedName;

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('[class*="description"], [class*="desc"]').first().text().replace(/\s+/g, ' ').trim() ||
    '';

  const images = new Set();
  $('img').each((_, img) => {
    const candidates = [
      $(img).attr('data-origin-src'),
      $(img).attr('data-src'),
      $(img).attr('data-lazy'),
      $(img).attr('src')
    ];

    for (const candidate of candidates) {
      const url = absolute(album.url, candidate);
      if (!url) continue;
      if (/yupoo|photo\./i.test(url) && !/avatar|logo|icon/i.test(url)) images.add(url);
    }
  });

  const category =
    $('[class*="breadcrumb"] a').last().text().replace(/\s+/g, ' ').trim() ||
    'Catálogo';

  return {
    id: album.id,
    name: title,
    category,
    description,
    sourceUrl: album.url,
    images: [...images]
  };
}

async function main() {
  console.log(`Analisando: ${sourceUrl}`);
  const indexHtml = await getHtml(sourceUrl);
  const albums = extractAlbumLinks(indexHtml, sourceUrl).slice(0, maxAlbums);

  if (!albums.length) {
    throw new Error('Nenhum álbum foi encontrado. O layout do Yupoo pode ter mudado ou a página pode exigir outro método de leitura.');
  }

  console.log(`${albums.length} álbuns selecionados para o MVP.`);
  const products = [];

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    try {
      const html = await getHtml(album.url);
      products.push(extractProduct(html, album));
      console.log(`[${i + 1}/${albums.length}] ${products.at(-1).name}`);
    } catch (error) {
      console.warn(`[${i + 1}/${albums.length}] falhou ${album.url}: ${error.message}`);
    }
  }

  const output = {
    source: sourceUrl,
    generatedAt: new Date().toISOString(),
    store: {
      name: 'Catalog Engine Demo',
      whatsapp: ''
    },
    products
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/catalog.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Concluído: ${products.length} produtos gravados em data/catalog.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
