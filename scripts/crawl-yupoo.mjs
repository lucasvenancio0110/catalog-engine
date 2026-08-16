import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  contentFingerprint,
  publicCategoryId,
  publicProductId,
  reconcileSyncState
} from './catalog-sync.mjs';

const provider = 'yupoo';
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
const syncStateData = resolve(root, 'data/sync-state.json');
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

function candidateWindow(remainingProducts, previousProductRatio = 0.65) {
  const safeRatio = Math.max(0.25, Math.min(1, previousProductRatio));
  const estimatedNeeded = Math.ceil(remainingProducts / safeRatio);
  return Math.max(16, Math.min(50, estimatedNeeded + 6));
}

function runWorker(url, cwd, maxCandidates) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [workerScript, url], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        MAX_ALBUMS: String(maxCandidates)
      }
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Extrator da página terminou com código ${code}.`));
    });
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function loadStoreConfig() {
  return (
    (await readJson(storeData)) || {
      name: 'Catalog Engine Demo',
      logo: '',
      whatsapp: '',
      instagram: '',
      theme: 'dark',
      currency: 'BRL',
      showDownload: true,
      showSource: false
    }
  );
}

function sanitizeProduct(product, publicId, images) {
  const {
    id,
    sourceUrl,
    sourceImages,
    sourceCategoryId,
    sourceCategoryName,
    sourceImageCount,
    confidence,
    reason,
    ...publicProduct
  } = product;

  return {
    ...publicProduct,
    id: publicId,
    category: publicProduct.category || sourceCategoryName || 'Catálogo',
    images,
    imageCount: images.length,
    entityType: 'product'
  };
}

function sanitizeTaxonomy(entry) {
  return {
    id: publicCategoryId(provider, entry.id),
    type: 'category',
    name: entry.name
  };
}

function mergeTaxonomy(previous, observed, complete) {
  if (complete || !Array.isArray(previous)) return observed;
  const merged = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of observed) merged.set(entry.id, entry);
  return [...merged.values()];
}

async function calculatePublicMediaStats(products) {
  const imagePaths = [...new Set(products.flatMap((product) => product.images || []))];
  let bytes = 0;
  for (const image of imagePaths) {
    bytes += await fileSize(resolve(root, image.replace(/^\.\//, '')));
  }
  return { photos: imagePaths.length, downloadedBytes: bytes };
}

async function main() {
  const hostname = new URL(sourceUrl).hostname;
  if (!hostname.endsWith('.x.yupoo.com')) {
    throw new Error('A fonte precisa ser um catálogo público do Yupoo (*.x.yupoo.com).');
  }

  const previousCatalog = await readJson(outputData, { products: [], taxonomy: [] });
  const previousSyncState = await readJson(syncStateData);
  const hasSyncBaseline = previousSyncState?.schemaVersion === 1;
  const migrationMode = !hasSyncBaseline;

  await rm(scratchRoot, { recursive: true, force: true });
  await mkdir(scratchRoot, { recursive: true });

  if (migrationMode) {
    console.log('Migração V0.7: removendo diretórios públicos legados com IDs brutos.');
    await rm(outputAssets, { recursive: true, force: true });
  }
  await mkdir(outputAssets, { recursive: true });

  const observedProductsById = new Map();
  const sourceProductsByPublicId = new Map();
  const taxonomyBySourceId = new Map();
  const navigationById = new Map();
  const informationById = new Map();
  const seenCandidateIds = new Set();
  let pagesScanned = 0;
  let candidatesScanned = 0;
  let previousProductRatio = 0.65;
  let extractionFailures = 0;
  let incompleteMedia = 0;
  let naturalEnd = false;
  let stopReason = 'page-limit';

  for (let page = 1; page <= maxPages && observedProductsById.size < maxAlbums; page++) {
    const remainingProducts = maxAlbums - observedProductsById.size;
    const maxCandidates = candidateWindow(remainingProducts, previousProductRatio);
    const pageDir = resolve(scratchRoot, `page-${page}`);
    await mkdir(pageDir, { recursive: true });

    const url = pagedUrl(sourceUrl, page);
    console.log(`\n=== CRAWL página ${page}/${maxPages}: ${url} | janela ${maxCandidates} candidatos para ${remainingProducts} produtos restantes ===`);

    await runWorker(url, pageDir, maxCandidates);

    const pageCatalog = JSON.parse(await readFile(resolve(pageDir, 'data/catalog.json'), 'utf8'));
    const pageProducts = Array.isArray(pageCatalog.products) ? pageCatalog.products : [];
    const pageItems = Array.isArray(pageCatalog.items) ? pageCatalog.items : pageProducts;
    const pageTaxonomy = Array.isArray(pageCatalog.taxonomy) ? pageCatalog.taxonomy : [];
    const pageNavigation = Array.isArray(pageCatalog.navigation) ? pageCatalog.navigation : [];
    const pageInformation = Array.isArray(pageCatalog.information) ? pageCatalog.information : [];
    const pageFailures = Number(pageCatalog.stats?.failed || 0);

    pagesScanned += 1;
    candidatesScanned += pageItems.length + pageFailures;
    extractionFailures += pageFailures;
    previousProductRatio = pageItems.length ? pageProducts.length / pageItems.length : previousProductRatio;

    for (const category of pageTaxonomy) {
      if (category?.id && category?.name) taxonomyBySourceId.set(String(category.id), category);
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

    let newObservedProducts = 0;
    for (const product of pageProducts) {
      if (observedProductsById.size >= maxAlbums) break;
      if (!product?.id) continue;

      const publicId = publicProductId(provider, product.id);
      if (observedProductsById.has(publicId)) continue;

      const sourceDir = resolve(pageDir, 'assets/catalog', String(product.id));
      const sourceImages = Array.isArray(product.images) ? product.images : [];
      const expectedImages = Number(product.sourceImageCount || sourceImages.length);
      const mediaComplete =
        sourceImages.length > 0 &&
        expectedImages > 0 &&
        sourceImages.length === expectedImages &&
        (await exists(sourceDir));

      if (!mediaComplete) {
        incompleteMedia += 1;
        console.warn(`Produto ${product.id} ignorado nesta sincronização: mídia incompleta (${sourceImages.length}/${expectedImages}).`);
        continue;
      }

      const destinationDir = resolve(outputAssets, publicId);
      await rm(destinationDir, { recursive: true, force: true });
      await mkdir(dirname(destinationDir), { recursive: true });
      await cp(sourceDir, destinationDir, { recursive: true, force: true });

      const publicImages = sourceImages.map(
        (image) => `./assets/catalog/${publicId}/${basename(image)}`
      );
      const publicProduct = sanitizeProduct(product, publicId, publicImages);
      observedProductsById.set(publicId, publicProduct);
      sourceProductsByPublicId.set(publicId, product);
      newObservedProducts += 1;
    }

    console.log(`Página ${page}: ${pageItems.length} itens válidos + ${pageFailures} falha(s), ${pageProducts.length} produtos classificados, ${newObservedProducts} produtos observados completos, ${observedProductsById.size}/${maxAlbums} consolidados.`);

    if (pageItems.length === 0 && pageFailures === 0) {
      naturalEnd = true;
      stopReason = 'empty-page';
      console.log('Fim natural detectado: página sem itens.');
      break;
    }
    if (page > 1 && newCandidates === 0 && pageFailures === 0) {
      naturalEnd = true;
      stopReason = 'repeated-page';
      console.log('Fim natural detectado: página repetiu apenas itens já conhecidos.');
      break;
    }
    if (observedProductsById.size >= maxAlbums) {
      stopReason = 'product-limit';
      break;
    }
    if (page === maxPages) stopReason = 'page-limit';
  }

  const observedPublicProducts = [...observedProductsById.values()];
  if (!observedPublicProducts.length) {
    throw new Error('Nenhum produto comercial com mídia completa foi consolidado pelo crawler.');
  }

  const complete = naturalEnd && extractionFailures === 0 && incompleteMedia === 0;
  if (naturalEnd && !complete) stopReason = `${stopReason}-with-failures`;
  const now = new Date().toISOString();
  const observedForSync = [...sourceProductsByPublicId.entries()].map(([publicId, product]) => ({
    publicId,
    contentHash: contentFingerprint(product)
  }));

  const reconciled = reconcileSyncState(
    hasSyncBaseline ? previousSyncState : null,
    observedForSync,
    { complete, now }
  );
  const syncState = {
    ...reconciled,
    scope: {
      complete,
      pagesScanned,
      maxPages,
      requestedMaxAlbums,
      stopReason,
      extractionFailures,
      incompleteMedia
    }
  };

  const previousPublicProducts =
    hasSyncBaseline && Array.isArray(previousCatalog.products)
      ? previousCatalog.products.filter((product) => /^p_[a-f0-9]{20}$/.test(String(product.id)))
      : [];
  const mergedProducts = new Map(previousPublicProducts.map((product) => [String(product.id), product]));
  for (const product of observedPublicProducts) mergedProducts.set(String(product.id), product);

  for (const removedId of syncState.changes.removed) {
    mergedProducts.delete(removedId);
    await rm(resolve(outputAssets, removedId), { recursive: true, force: true });
  }

  const products = [...mergedProducts.values()].filter(
    (product) => syncState.products[String(product.id)]?.status !== 'removed'
  );
  const store = await loadStoreConfig();
  const observedTaxonomy = [...taxonomyBySourceId.values()].map(sanitizeTaxonomy);
  const taxonomy = mergeTaxonomy(previousCatalog.taxonomy, observedTaxonomy, complete || migrationMode);
  const navigation = [...navigationById.values()];
  const information = [...informationById.values()];
  const mediaStats = await calculatePublicMediaStats(products);

  const output = {
    schemaVersion: 4,
    generatedAt: now,
    store,
    taxonomy,
    sync: {
      scopeComplete: complete,
      stopReason,
      observedProducts: observedPublicProducts.length,
      publicProducts: products.length,
      changes: syncState.summary
    },
    crawl: {
      pagesScanned,
      maxPages,
      requestedMaxAlbums,
      observedProducts: observedPublicProducts.length,
      publicProducts: products.length,
      candidatesScanned,
      taxonomyEntries: taxonomy.length,
      skippedNavigation: navigation.length,
      skippedInformation: information.length,
      extractionFailures,
      incompleteMedia,
      storageMode: 'repository-mvp',
      hardAlbumLimit
    },
    stats: {
      products: products.length,
      photos: mediaStats.photos,
      downloadedBytes: mediaStats.downloadedBytes
    },
    products
  };

  const sourceState = {
    schemaVersion: 2,
    source: sourceUrl,
    generatedAt: now,
    scope: syncState.scope,
    taxonomy: [...taxonomyBySourceId.values()],
    navigation,
    information,
    products: [...sourceProductsByPublicId.entries()].map(([publicId, product]) => ({
      publicId,
      sourceId: product.id,
      sourceUrl: product.sourceUrl,
      sourceImages: product.sourceImages,
      sourceCategoryId: product.sourceCategoryId,
      sourceCategoryName: product.sourceCategoryName,
      contentHash: contentFingerprint(product),
      classification: {
        entityType: product.entityType,
        confidence: product.confidence,
        reason: product.reason
      }
    }))
  };

  await mkdir(dirname(outputData), { recursive: true });
  await writeFile(outputData, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await writeFile(syncStateData, `${JSON.stringify(syncState, null, 2)}\n`, 'utf8');
  await writeFile(sourceStateData, `${JSON.stringify(sourceState, null, 2)}\n`, 'utf8');
  await rm(scratchRoot, { recursive: true, force: true });

  console.log(`\nSYNC concluído: ${observedPublicProducts.length} observados, ${products.length} públicos, ${mediaStats.photos} fotos, escopo ${complete ? 'COMPLETO' : 'PARCIAL'} (${stopReason}).`);
  console.log(`Mudanças: +${syncState.summary.new} novos, ~${syncState.summary.updated} atualizados, ↩${syncState.summary.restored} restaurados, -${syncState.summary.removed} removidos, ?${syncState.summary.unobserved} não observados preservados.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
