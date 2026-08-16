import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import PQueue from 'p-queue';
import sharp from 'sharp';

const root = process.cwd();
const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const manifest = JSON.parse(await readFile('data/media-manifest.json', 'utf8'));
const mediaIdPattern = /^m_[a-f0-9]{20}$/;
const hashPattern = /^[a-f0-9]{64}$/;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function localPath(url) {
  if (!String(url).startsWith('./assets/media/')) {
    throw new Error(`URL fora do media store público: ${url}`);
  }
  return resolve(root, String(url).replace(/^\.\//, ''));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function descriptorKey(media) {
  return `${media.id}:${media.hash}`;
}

if (catalog.schemaVersion < 6 || catalog.mediaVersion !== 1) {
  throw new Error('Media audit exige catalog schemaVersion >= 6 e mediaVersion 1.');
}
if (manifest.schemaVersion !== 1 || manifest.storage?.mode !== 'repository') {
  throw new Error('Media manifest inválido para o storage repository atual.');
}
if (await exists(resolve(root, 'assets/catalog'))) {
  throw new Error('Pasta legada assets/catalog ainda existe após a migração de mídia.');
}

const logicalMedia = (catalog.products || []).flatMap((product) => product.images || []);
if (!logicalMedia.length) throw new Error('Catálogo sem mídia para auditar.');

for (const product of catalog.products || []) {
  if (!Array.isArray(product.images) || !product.images.length) throw new Error(`Produto sem mídia: ${product.id}`);
  if (product.imageCount !== undefined && product.imageCount !== product.images.length) {
    throw new Error(`imageCount divergente no produto ${product.id}.`);
  }
  for (const media of product.images) {
    if (!media || typeof media !== 'object') throw new Error(`Produto ${product.id} ainda usa imagem legada string.`);
    if (!mediaIdPattern.test(String(media.id || ''))) throw new Error(`Media ID inválido no produto ${product.id}.`);
    if (!hashPattern.test(String(media.hash || ''))) throw new Error(`Media hash inválido no produto ${product.id}.`);
    if (media.id !== `m_${media.hash.slice(0, 20)}`) throw new Error(`Media ID não corresponde ao hash: ${media.id}`);
    if (!Number.isInteger(media.width) || !Number.isInteger(media.height) || media.width < 1 || media.height < 1) {
      throw new Error(`Dimensões originais inválidas em ${media.id}.`);
    }
    if (!Number.isInteger(media.bytes) || media.bytes < 1) throw new Error(`Bytes originais inválidos em ${media.id}.`);
    for (const url of [media.url, media.thumbnailUrl, media.downloadUrl]) localPath(url);
  }
}

const unique = new Map();
for (const media of logicalMedia) unique.set(media.hash, media);
const manifestByHash = new Map((manifest.media || []).map((media) => [media.hash, media]));
if (manifestByHash.size !== unique.size) {
  throw new Error(`Manifest e catálogo divergem em mídia única: ${manifestByHash.size} vs ${unique.size}.`);
}

const queue = new PQueue({ concurrency: 4, timeout: 30_000 });
const audits = [...unique.values()].map((media) => queue.add(async () => {
  const manifestMedia = manifestByHash.get(media.hash);
  if (!manifestMedia || descriptorKey(manifestMedia) !== descriptorKey(media)) {
    throw new Error(`Manifest não contém descriptor correto para ${media.id}.`);
  }

  const [originalBytes, webMeta, thumbMeta] = await Promise.all([
    readFile(localPath(media.downloadUrl)),
    sharp(localPath(media.url), { failOn: 'warning' }).metadata(),
    sharp(localPath(media.thumbnailUrl), { failOn: 'warning' }).metadata()
  ]);

  if (sha256(originalBytes) !== media.hash) throw new Error(`SHA-256 original divergente em ${media.id}.`);
  if (originalBytes.length !== media.bytes) throw new Error(`Tamanho original divergente em ${media.id}.`);

  const originalMeta = await sharp(originalBytes, { failOn: 'warning' }).metadata();
  if (originalMeta.width !== media.width || originalMeta.height !== media.height || originalMeta.format !== media.format) {
    throw new Error(`Metadados originais divergentes em ${media.id}.`);
  }
  if (webMeta.format !== 'webp' || !webMeta.width || !webMeta.height || webMeta.width > 1600 || webMeta.height > 1600) {
    throw new Error(`Derivada web inválida em ${media.id}.`);
  }
  if (thumbMeta.format !== 'webp' || !thumbMeta.width || !thumbMeta.height || thumbMeta.width > 480 || thumbMeta.height > 480) {
    throw new Error(`Thumbnail inválida em ${media.id}.`);
  }

  return { originalBytes: originalBytes.length };
}));

const results = await Promise.all(audits);
const refCounts = new Map();
for (const media of logicalMedia) refCounts.set(media.id, (refCounts.get(media.id) || 0) + 1);
for (const media of manifest.media || []) {
  if (media.refCount !== (refCounts.get(media.id) || 0)) throw new Error(`refCount divergente em ${media.id}.`);
}

const stats = catalog.mediaStats || {};
if (stats.logicalImages !== logicalMedia.length || stats.uniqueImages !== unique.size) {
  throw new Error('mediaStats diverge das referências do catálogo.');
}

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  mediaVersion: catalog.mediaVersion,
  products: catalog.products.length,
  logicalImages: logicalMedia.length,
  uniqueImages: unique.size,
  duplicateReferences: logicalMedia.length - unique.size,
  originalMB: Number((results.reduce((sum, item) => sum + item.originalBytes, 0) / 1024 / 1024).toFixed(2)),
  webMB: Number((Number(stats.webBytes || 0) / 1024 / 1024).toFixed(2)),
  thumbnailMB: Number((Number(stats.thumbnailBytes || 0) / 1024 / 1024).toFixed(2)),
  deduplicatedMB: Number((Number(stats.deduplicatedBytes || 0) / 1024 / 1024).toFixed(2)),
  legacyAssets: false,
  storageMode: manifest.storage.mode,
  concurrency: 4
}, null, 2));
