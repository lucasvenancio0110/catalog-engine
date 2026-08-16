import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import PQueue from 'p-queue';
import { RepositoryMediaStore } from './media/repository-media-store.mjs';
import { processMediaFile } from './media/media-processor.mjs';

function isDescriptor(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    /^m_[a-f0-9]{20}$/.test(String(value.id || '')) &&
    /^[a-f0-9]{64}$/.test(String(value.hash || '')) &&
    value.url &&
    value.thumbnailUrl &&
    value.downloadUrl
  );
}

function localPath(root, url) {
  if (!String(url).startsWith('./')) {
    throw new Error(`Repository media pipeline exige mídia local relativa: ${url}`);
  }
  return resolve(root, String(url).replace(/^\.\//, ''));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function referencedUrls(descriptors) {
  return descriptors.flatMap((media) => [media.url, media.thumbnailUrl, media.downloadUrl]);
}

export async function optimizeCatalogMedia({
  root = process.cwd(),
  catalogPath = 'data/catalog.json',
  manifestPath = 'data/media-manifest.json',
  legacyAssetsPath = 'assets/catalog',
  store = new RepositoryMediaStore(),
  concurrency = 4,
  prune = true
} = {}) {
  const absoluteCatalog = resolve(root, catalogPath);
  const catalog = JSON.parse(await readFile(absoluteCatalog, 'utf8'));
  if (!Array.isArray(catalog.products) || !catalog.products.length) {
    throw new Error('Catálogo sem produtos para otimização de mídia.');
  }

  const queue = new PQueue({ concurrency, timeout: 60_000 });
  const processingByPath = new Map();
  const logicalDescriptors = [];

  async function descriptorFor(image) {
    if (isDescriptor(image)) {
      const paths = [image.url, image.thumbnailUrl, image.downloadUrl].map((url) => localPath(root, url));
      if ((await Promise.all(paths.map(exists))).every(Boolean)) return image;
    }

    const sourceUrl = typeof image === 'string' ? image : image?.downloadUrl || image?.url;
    if (!sourceUrl) throw new Error('Entrada de mídia inválida no catálogo.');
    const path = localPath(root, sourceUrl);
    if (!(await exists(path))) throw new Error(`Mídia de origem ausente: ${sourceUrl}`);

    if (!processingByPath.has(path)) {
      processingByPath.set(path, queue.add(() => processMediaFile(path, store), { id: path }));
    }
    return processingByPath.get(path);
  }

  const products = [];
  for (const product of catalog.products) {
    const inputImages = Array.isArray(product.images) ? product.images : [];
    if (!inputImages.length) throw new Error(`Produto sem mídia: ${product.id}`);
    const media = await Promise.all(inputImages.map(descriptorFor));
    logicalDescriptors.push(...media);
    products.push({ ...product, images: media, imageCount: media.length });
  }

  await queue.onIdle();

  const uniqueByHash = new Map();
  const refsById = new Map();
  for (const media of logicalDescriptors) {
    uniqueByHash.set(media.hash, media);
    refsById.set(media.id, (refsById.get(media.id) || 0) + 1);
  }
  const unique = [...uniqueByHash.values()];

  const logicalOriginalBytes = logicalDescriptors.reduce((sum, media) => sum + Number(media.bytes || 0), 0);
  const uniqueOriginalBytes = unique.reduce((sum, media) => sum + Number(media.bytes || 0), 0);
  const webBytes = unique.reduce((sum, media) => sum + Number(media.web?.bytes || 0), 0);
  const thumbnailBytes = unique.reduce((sum, media) => sum + Number(media.thumbnail?.bytes || 0), 0);

  const generatedAt = new Date().toISOString();
  const output = {
    ...catalog,
    schemaVersion: Math.max(6, Number(catalog.schemaVersion || 0)),
    mediaVersion: 1,
    mediaStats: {
      storageMode: store.mode,
      logicalImages: logicalDescriptors.length,
      uniqueImages: unique.length,
      duplicateReferences: logicalDescriptors.length - unique.length,
      logicalOriginalBytes,
      uniqueOriginalBytes,
      webBytes,
      thumbnailBytes,
      deduplicatedBytes: Math.max(0, logicalOriginalBytes - uniqueOriginalBytes)
    },
    products
  };

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    storage: { mode: store.mode, publicBase: store.publicBase },
    stats: output.mediaStats,
    media: unique.map((media) => ({ ...media, refCount: refsById.get(media.id) || 0 }))
  };

  await mkdir(dirname(absoluteCatalog), { recursive: true });
  await writeFile(absoluteCatalog, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await writeFile(resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  let pruneResult = { removed: 0, removedBytes: 0 };
  if (prune) pruneResult = await store.prune(referencedUrls(unique));

  const legacy = resolve(root, legacyAssetsPath);
  if (await exists(legacy)) await rm(legacy, { recursive: true, force: true });

  return { catalog: output, manifest, prune: pruneResult };
}

async function main() {
  const result = await optimizeCatalogMedia();
  console.log(JSON.stringify({
    ok: true,
    schemaVersion: result.catalog.schemaVersion,
    mediaVersion: result.catalog.mediaVersion,
    products: result.catalog.products.length,
    ...result.catalog.mediaStats,
    prunedFiles: result.prune.removed,
    prunedBytes: result.prune.removedBytes
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
