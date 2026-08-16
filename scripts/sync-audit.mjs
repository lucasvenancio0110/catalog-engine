import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const syncState = JSON.parse(await readFile('data/sync-state.json', 'utf8'));
const catalogSerialized = JSON.stringify(catalog);
const syncSerialized = JSON.stringify(syncState);
const supplierPattern = /x\.yupoo\.com|photo\.yupoo\.com/i;
const publicProductPattern = /^p_[a-f0-9]{20}$/;
const publicCategoryPattern = /^c_[a-f0-9]{20}$/;
const publicScopePattern = /^s_[a-f0-9]{20}$/;
const contentHashPattern = /^[a-f0-9]{64}$/;

if (catalog.schemaVersion < 4) throw new Error('Sync audit exige catalog schemaVersion >= 4.');
if (syncState.schemaVersion !== 2) throw new Error('sync-state schemaVersion 2 é obrigatório para o ledger por escopo.');
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
  .flatMap((product) => [
    ...(product.images || []),
    ...(product.media || []).flatMap((media) => [media.url, media.thumbnailUrl, media.downloadUrl])
  ])
  .filter((image) => /\/assets\/catalog\/\d+\//.test(image));

if (invalidProductIds.length || invalidCategoryIds.length || rawAssetPaths.length) {
  throw new Error(`Identidade pública inválida: ${JSON.stringify({ invalidProductIds, invalidCategoryIds, rawAssetPaths: rawAssetPaths.slice(0, 5) })}`);
}

if (!publicScopePattern.test(String(syncState.scope?.id || ''))) {
  throw new Error('Escopo atual não possui ID público opaco válido.');
}
if (!['catalog', 'category', 'source', 'legacy'].includes(syncState.scope?.kind)) {
  throw new Error('Escopo atual possui tipo inválido.');
}

const syncEntries = Object.entries(syncState.products || {});
for (const [publicId, entry] of syncEntries) {
  if (!publicProductPattern.test(publicId)) throw new Error(`sync-state contém ID público inválido: ${publicId}`);
  if (!contentHashPattern.test(entry.contentHash || '')) throw new Error(`sync-state contém hash inválido: ${publicId}.`);
  if (!['active', 'removed'].includes(entry.status)) throw new Error(`sync-state contém status inválido: ${publicId}`);
}

const scopeEntries = Object.entries(syncState.scopes || {});
if (!scopeEntries.length) throw new Error('Ledger de escopos vazio.');

const membershipCount = new Map();
for (const [scopeId, scope] of scopeEntries) {
  if (!publicScopePattern.test(scopeId)) throw new Error(`Escopo persistido com ID inválido: ${scopeId}`);
  if (!['catalog', 'category', 'source', 'legacy'].includes(scope.kind)) {
    throw new Error(`Escopo persistido com tipo inválido: ${scopeId}`);
  }
  if (!Array.isArray(scope.members)) throw new Error(`Escopo sem lista de membros: ${scopeId}`);
  if (new Set(scope.members).size !== scope.members.length) throw new Error(`Escopo contém membros duplicados: ${scopeId}`);

  for (const publicId of scope.members) {
    if (!publicProductPattern.test(publicId)) throw new Error(`Escopo ${scopeId} contém membro inválido: ${publicId}`);
    const product = syncState.products?.[publicId];
    if (!product) throw new Error(`Escopo ${scopeId} referencia produto inexistente: ${publicId}`);
    if (product.status !== 'active') throw new Error(`Produto removido ainda pertence ao escopo ${scopeId}: ${publicId}`);
    membershipCount.set(publicId, (membershipCount.get(publicId) || 0) + 1);
  }
}

const publicIds = new Set((catalog.products || []).map((product) => String(product.id)));
const missingActiveProducts = syncEntries
  .filter(([publicId, entry]) => entry.status === 'active' && !publicIds.has(publicId))
  .map(([publicId]) => publicId);
const publishedRemovedProducts = syncEntries
  .filter(([publicId, entry]) => entry.status === 'removed' && publicIds.has(publicId))
  .map(([publicId]) => publicId);
const activeWithoutScope = syncEntries
  .filter(([publicId, entry]) => entry.status === 'active' && !membershipCount.has(publicId))
  .map(([publicId]) => publicId);
const removedWithScope = syncEntries
  .filter(([publicId, entry]) => entry.status === 'removed' && membershipCount.has(publicId))
  .map(([publicId]) => publicId);

if (missingActiveProducts.length || publishedRemovedProducts.length || activeWithoutScope.length || removedWithScope.length) {
  throw new Error(`Catálogo e ledger divergiram: ${JSON.stringify({ missingActiveProducts, publishedRemovedProducts, activeWithoutScope, removedWithScope })}`);
}

let checkedImages = 0;
for (const product of catalog.products || []) {
  for (const image of product.images || []) {
    if (catalog.schemaVersion >= 6) {
      if (!image.startsWith('./assets/media/web/')) {
        throw new Error(`Imagem web fora do media store no produto ${product.id}: ${image}`);
      }
    } else if (!image.includes(`/assets/catalog/${product.id}/`)) {
      throw new Error(`Imagem fora do namespace do produto ${product.id}: ${image}`);
    }
    await stat(resolve(process.cwd(), image.replace(/^\.\//, '')));
    checkedImages += 1;
  }
}

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  syncSchemaVersion: syncState.schemaVersion,
  publicProducts: publicIds.size,
  syncRecords: syncEntries.length,
  scopes: scopeEntries.length,
  scopeKinds: Object.fromEntries(
    [...new Set(scopeEntries.map(([, scope]) => scope.kind))].map((kind) => [
      kind,
      scopeEntries.filter(([, scope]) => scope.kind === kind).length
    ])
  ),
  checkedImages,
  storageMode: catalog.schemaVersion >= 6 ? 'content-addressed' : 'product-folders',
  scopeComplete: Boolean(syncState.scope?.complete),
  currentScopeKind: syncState.scope?.kind,
  stopReason: syncState.scope?.stopReason || null,
  changes: syncState.summary,
  supplierLeak: false,
  rawPublicIds: false
}, null, 2));
