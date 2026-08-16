import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourceUrl = process.argv[2] || 'https://zhouchangliang.x.yupoo.com/albums/';
const requestedMaxAlbums = Number(process.env.MAX_ALBUMS || 40);
const requestedMaxPages = Number(process.env.MAX_PAGES || 3);
const hardAlbumLimit = 120;
const hardPageLimit = 10;

if (!Number.isFinite(requestedMaxAlbums) || requestedMaxAlbums < 1) {
  throw new Error('MAX_ALBUMS precisa ser um número maior que zero.');
}
if (!Number.isFinite(requestedMaxPages) || requestedMaxPages < 1) {
  throw new Error('MAX_PAGES precisa ser um número maior que zero.');
}
if (requestedMaxAlbums > hardAlbumLimit) {
  throw new Error(`O MVP limita a importação a ${hardAlbumLimit} álbuns enquanto as imagens ainda ficam no GitHub. Para escalar além disso, migraremos o storage para objeto/CDN.`);
}

const maxAlbums = Math.min(requestedMaxAlbums, hardAlbumLimit);
const maxPages = Math.min(requestedMaxPages, hardPageLimit);
const root = process.cwd();
const workerScript = resolve(root, 'scripts/scrape-yupoo.mjs');
const scratchRoot = resolve(root, '.crawl');
const outputAssets = resolve(root, 'assets/catalog');
const outputData = resolve(root, 'data/catalog.json');

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

function runWorker(url, cwd, maxForPage) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [workerScript, url], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        MAX_ALBUMS: String(maxForPage)
      }
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Extrator da página terminou com código ${code}.`));
    });
  });
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function main() {
  const hostname = new URL(sourceUrl).hostname;
  if (!hostname.endsWith('.x.yupoo.com')) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }

  await rm(scratchRoot, { recursive: true, force: true });
  await rm(outputAssets, { recursive: true, force: true });
  await mkdir(scratchRoot, { recursive: true });
  await mkdir(outputAssets, { recursive: true });

  const productsById = new Map();
  let pagesScanned = 0;
  let totalBytes = 0;
  let totalPhotos = 0;

  for (let page = 1; page <= maxPages && productsById.size < maxAlbums; page++) {
    const remaining = maxAlbums - productsById.size;
    const pageDir = resolve(scratchRoot, `page-${page}`);
    await mkdir(pageDir, { recursive: true });

    const url = pagedUrl(sourceUrl, page);
    console.log(`\n=== CRAWL página ${page}/${maxPages}: ${url} ===`);

    await runWorker(url, pageDir, Math.min(50, Math.max(1, remaining)));

    const pageCatalog = JSON.parse(await readFile(resolve(pageDir, 'data/catalog.json'), 'utf8'));
    const pageProducts = Array.isArray(pageCatalog.products) ? pageCatalog.products : [];
    pagesScanned += 1;

    let newProducts = 0;
    for (const product of pageProducts) {
      if (productsById.size >= maxAlbums) break;
      if (!product?.id || productsById.has(product.id)) continue;

      const sourceDir = resolve(pageDir, 'assets/catalog', String(product.id));
      const destinationDir = resolve(outputAssets, String(product.id));
      await mkdir(dirname(destinationDir), { recursive: true });
      await cp(sourceDir, destinationDir, { recursive: true, force: true });

      for (const image of product.images || []) {
        const localPath = resolve(root, image.replace(/^\.\//, ''));
        totalBytes += await fileSize(localPath);
      }
      totalPhotos += (product.images || []).length;
      productsById.set(product.id, product);
      newProducts += 1;
    }

    console.log(`Página ${page}: ${pageProducts.length} lidos, ${newProducts} novos, ${productsById.size}/${maxAlbums} consolidados.`);

    if (pageProducts.length === 0) {
      console.log('Fim detectado: página sem produtos.');
      break;
    }
    if (page > 1 && newProducts === 0) {
      console.log('Fim detectado: página repetiu apenas álbuns já conhecidos.');
      break;
    }
  }

  const products = [...productsById.values()];
  if (!products.length) throw new Error('Nenhum produto foi consolidado pelo crawler.');

  const categoryIds = [...new Set(products.map((product) => {
    try {
      return new URL(product.sourceUrl).searchParams.get('referrercate');
    } catch {
      return null;
    }
  }).filter(Boolean))];

  const output = {
    schemaVersion: 2,
    source: sourceUrl,
    generatedAt: new Date().toISOString(),
    store: {
      name: 'Catalog Engine Demo',
      whatsapp: ''
    },
    crawl: {
      pagesScanned,
      maxPages,
      requestedMaxAlbums,
      selectedAlbums: products.length,
      categoryIds,
      storageMode: 'repository-mvp',
      hardAlbumLimit
    },
    stats: {
      products: products.length,
      photos: totalPhotos,
      downloadedBytes: totalBytes
    },
    products
  };

  await mkdir(dirname(outputData), { recursive: true });
  await writeFile(outputData, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await rm(scratchRoot, { recursive: true, force: true });

  console.log(`\nCRAWL concluído: ${products.length} produtos em ${pagesScanned} página(s), ${totalPhotos} fotos, ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
