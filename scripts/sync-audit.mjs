import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const syncState = JSON.parse(await readFile('data/sync-state.json', 'utf8'));
const catalogSerialized = JSON.stringify(catalog);
const syncSerialized = JSON.stringify(syncState);
const supplierPattern = /x\.yupoo\.com|photo\.yupoo\.com/i;
const publicProductPattern = /^p_[a-f0-9]{20}$/;
const publicCategoryPattern = /^c_[a-f0-9]{20}$/;
const contentHashPattern = /^[a-f0-9]{64}$/;

if (catalog.schemaVersion < 4) throw new Error('Sync audit exige catalog schemaVersion >= 4.');
if (syncState.schemaVersion !== 1) throw new Error('sync-state schemaVersion inválido.');
if (supplierPattern.test(catalogSerialized) || supplierPattern.test(syncSerialized)) {
  throw new Error('White-label sync gate: fornecedor apareceu em dados persistentes.');
}

const invalidProductIds = (catalog.products || [])
  .map((product) => String(product.id))
  .filter((id) => !publicProductPattern.test(id));
const invalidCategoryIds = (catalog.taxonomy || [])
  .map((category) => String(category.id))
  .filter((id) => !publicCategoryPattern.test(id));
const rawAssetPaths = (catalog.products || [])
  .flatMap((product) => product.images || [])
  .filter((image) => /\/assets\/catalog\/\d+\//.test(image));

if (invalidProductIds.length || invalidCategoryIds.length || rawAssetPaths.length) {
  throw new Error(`Identidade pública inválida: ${JSON.stringify({ invalidProductIds, invalidCategoryIds, rawAssetPaths: rawAssetPaths.slice(0, 5) })}`);
}

const syncEntries = Object.entries(syncState.products || {});
for (const [publicId, entry] of syncEntries) {
  if (!publicProductPattern.test(publicId)) throw new Error(`sync-state contém ID público inválido: ${publicId}`);
  if (!contentHashPattern.test(entry.contentHash || '')) throw new Error(`sync-state contém hash inválido: ${publicId}`);
  if (!['active', 'removed'].includes(entry.status)) throw new Error(`sync-state contém status inválido: ${publicId}`);
}

const publicIds = new Set((catalog.products || []).map((product) => String(product.id)));
const missingActiveProducts = syncEntries
  .filter(([publicId, entry]) => entry.status === 'active' && !publicIds.has(publicId))
  .map(([publicId]) => publicId);
const publishedRemovedProducts = syncEntries
  .filter(([publicId, entry]) => entry.status === 'removed' && publicIds.has(publicId))
  .map(([publicId]) => publicId);

if (missingActiveProducts.length || publishedRemovedProducts.length) {
  throw new Error(`Catálogo e sync-state divergiram: ${JSON.stringify({ missingActiveProducts, publishedRemovedProducts })}`);
}

let checkedImages = 0;
for (const product of catalog.products || []) {
  for (const image of product.images || []) {
    if (!image.includes(`/assets/catalog/${product.id}/`)) {
      throw new Error(`Imagem fora do namespace do produto ${product.id}: ${image}`);
    }
    await stat(resolve(process.cwd(), image.replace(/^\.\//, '')));
    checkedImages += 1;
  }
}

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  publicProducts: publicIds.size,
  syncRecords: syncEntries.length,
  checkedImages,
  scopeComplete: Boolean(syncState.scope?.complete),
  stopReason: syncState.scope?.stopReason || null,
  changes: syncState.summary,
  supplierLeak: false,
  rawPublicIds: false
}, null, 2));
