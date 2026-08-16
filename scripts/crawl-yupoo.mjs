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
  throw new Error(`O MVP limita a importação a ${hardAlbumLimit} produtos enquanto as imagens ainda ficam no GitHub. Para escalar além disso, migraremos o storage para objeto/CDN.`);
}

const maxAlbums = Math.min(requestedMaxAlbums, hardAlbumLimit);
const maxPages = Math.min(requestedMaxPages, hardPageLimit);
const root = process.cwd();
const workerScript = resolve(root, 'scripts/scrape-yupoo.mjs');
const scratchRoot = resolve(root, '.crawl');
const outputAssets = resolve(root, 'assets/catalog');
const outputData = resolve(root, 'data/catalog.json');
const sourceStateData = resolve(root, 'data/source-state.json');
const storeData = resolve(root, 'data/store.json');

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

function runWorker(url, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [workerScript, url], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        MAX_ALBUMS: '50'
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadStoreConfig() {
  try {
    return JSON.parse(await readFile(storeData, 'utf8'));
  } catch {
    return {
      name: 'Catalog Engine Demo',
      logo: '',
      whatsapp: '',
      instagram: '',
      theme: 'dark',
      currency: 'BRL',
      showDownload: true,
      showSource: false
    };
  }
}

function sanitizeProduct(product) {
  const {
    sourceUrl,
    sourceImages,
    sourceCategoryId,
    sourceCategoryName,
    confidence,
    reason,
    ...publicProduct
  } = product;

  return {
    ...publicProduct,
    category: publicProduct.category || sourceCategoryName || 'Catálogo'
  };
}

function sanitizeTaxonomy(entry) {
  return {
    id: String(entry.id),
    type: 'category',
    name: entry.name
  };
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
  const taxonomyById = new Map();
  const navigationById = new Map();
  const informationById = new Map();
  const seenCandidateIds = new Set();
  let pagesScanned = 0;
  let totalBytes = 0;
  let totalPhotos = 0;
  let candidatesScanned = 0;

  for (let page = 1; page <= maxPages && productsById.size < maxAlbums; page++) {
    const pageDir = resolve(scratchRoot, `page-${page}`);
    await mkdir(pageDir, { recursive: true });

    const url = pagedUrl(sourceUrl, page);
    console.log(`\n=== CRAWL página ${page}/${maxPages}: ${url} ===`);

    await runWorker(url, pageDir);

    const pageCatalog = JSON.parse(await readFile(resolve(pageDir, 'data/catalog.json'), 'utf8'));
    const pageProducts = Array.isArray(pageCatalog.products) ? pageCatalog.products : [];
    const pageItems = Array.isArray(pageCatalog.items) ? pageCatalog.items : pageProducts;
    const pageTaxonomy = Array.isArray(pageCatalog.taxonomy) ? pageCatalog.taxonomy : [];
    const pageNavigation = Array.isArray(pageCatalog.navigation) ? pageCatalog.navigation : [];
    const pageInformation = Array.isArray(pageCatalog.information) ? pageCatalog.information : [];
    pagesScanned += 1;
    candidatesScanned += pageItems.length;

    for (const category of pageTaxonomy) {
      if (category?.id && category?.name) taxonomyById.set(String(category.id), category);
    }
    for (const item of pageNavigation) {
      if (item?.id) navigationById.set(String(item.id), item);
    }
    for (const item of pageInformation) {
      if (item?.id) informationById.set(String(item.id), item);
    }

    let newCandidates = 0;
    for (const item of pageItems) {
      if (!item?.id || seenCandidateIds.has(String(item.id))) continue;
      seenCandidateIds.add(String(item.id));
      newCandidates += 1;
    }

    let newProducts = 0;
    for (const product of pageProducts) {
      if (productsById.size >= maxAlbums) break;
      if (!product?.id || productsById.has(String(product.id))) continue;

      const sourceDir = resolve(pageDir, 'assets/catalog', String(product.id));
      const destinationDir = resolve(outputAssets, String(product.id));
      if (await exists(sourceDir)) {
        await mkdir(dirname(destinationDir), { recursive: true });
        await cp(sourceDir, destinationDir, { recursive: true, force: true });
      }

      for (const image of product.images || []) {
        const localPath = resolve(root, image.replace(/^\.\//, ''));
        totalBytes += await fileSize(localPath);
      }
      totalPhotos += (product.images || []).length;
      productsById.set(String(product.id), product);
      newProducts += 1;
    }

    console.log(`Página ${page}: ${pageItems.length} candidatos, ${pageProducts.length} produtos classificados, ${newProducts} produtos novos, ${productsById.size}/${maxAlbums} consolidados.`);

    if (pageItems.length === 0) {
      console.log('Fim detectado: página sem itens.');
      break;
    }
    if (page > 1 && newCandidates === 0) {
      console.log('Fim detectado: página repetiu apenas itens já conhecidos.');
      break;
    }
  }

  const sourceProducts = [...productsById.values()];
  if (!sourceProducts.length) throw new Error('Nenhum produto comercial foi consolidado pelo crawler.');

  const store = await loadStoreConfig();
  const taxonomy = [...taxonomyById.values()].map(sanitizeTaxonomy);
  const products = sourceProducts.map(sanitizeProduct);
  const navigation = [...navigationById.values()];
  const information = [...informationById.values()];

  const output = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    store,
    taxonomy,
    crawl: {
      pagesScanned,
      maxPages,
      requestedMaxAlbums,
      selectedProducts: products.length,
      candidatesScanned,
      taxonomyEntries: taxonomy.length,
      skippedNavigation: navigation.length,
      skippedInformation: information.length,
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

  const sourceState = {
    schemaVersion: 1,
    source: sourceUrl,
    generatedAt: output.generatedAt,
    taxonomy: [...taxonomyById.values()],
    navigation,
    information,
    products: sourceProducts.map((product) => ({
      id: product.id,
      sourceUrl: product.sourceUrl,
      sourceImages: product.sourceImages,
      sourceCategoryId: product.sourceCategoryId,
      sourceCategoryName: product.sourceCategoryName,
      classification: {
        entityType: product.entityType,
        confidence: product.confidence,
        reason: product.reason
      }
    }))
  };

  await mkdir(dirname(outputData), { recursive: true });
  await writeFile(outputData, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await writeFile(sourceStateData, `${JSON.stringify(sourceState, null, 2)}\n`, 'utf8');
  await rm(scratchRoot, { recursive: true, force: true });

  console.log(`\nCRAWL concluído: ${products.length} produtos em ${pagesScanned} página(s), ${totalPhotos} fotos, ${taxonomy.length} categorias detectadas, ${navigation.length + information.length} itens não comerciais filtrados, ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
