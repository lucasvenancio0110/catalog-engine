import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const serialized = JSON.stringify(catalog);

if (catalog.mediaVersion !== 2 || catalog.storage?.mode !== 'edge-proxy' || catalog.storage?.publicBase !== '/media') {
  throw new Error('Catálogo não está configurado para edge-proxy mediaVersion 2.');
}
if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(serialized)) {
  throw new Error('White-label violation: hostname do fornecedor apareceu no catálogo público.');
}
if (await exists(resolve('assets/media'))) {
  throw new Error('assets/media ainda existe; o modo edge-proxy não deve manter imagens do fornecedor no repositório.');
}
if (await exists(resolve('data/media-manifest.json'))) {
  throw new Error('data/media-manifest.json ainda existe; manifest repository ficou obsoleto no edge-proxy.');
}

let logicalImages = 0;
const uniqueIds = new Set();
for (const product of catalog.products || []) {
  if (!/^p_[a-f0-9]{20}$/.test(String(product.id || ''))) throw new Error(`Produto com ID público inválido: ${product.id}`);
  if (!Array.isArray(product.images) || !product.images.length) throw new Error(`Produto sem imagens: ${product.id}`);
  if (!Array.isArray(product.media) || product.media.length !== product.images.length) {
    throw new Error(`Descriptors de mídia desalinhados: ${product.id}`);
  }

  product.media.forEach((media, index) => {
    if (!/^m_[a-f0-9]{20}$/.test(String(media.id || ''))) throw new Error(`Media ID inválido em ${product.id}.`);
    const expected = `/media/${media.id}`;
    if (product.images[index] !== expected || media.url !== expected || media.thumbnailUrl !== expected || media.downloadUrl !== expected) {
      throw new Error(`Rota pública de mídia divergente em ${product.id}/${media.id}.`);
    }
    if (media.storage !== 'edge-proxy') throw new Error(`Descriptor sem storage edge-proxy: ${media.id}.`);
    logicalImages += 1;
    uniqueIds.add(media.id);
  });
}

if (!logicalImages) throw new Error('Nenhuma mídia edge-proxy foi encontrada.');
if (catalog.mediaStats?.logicalImages !== logicalImages || catalog.mediaStats?.uniqueImages !== uniqueIds.size) {
  throw new Error('mediaStats diverge das referências edge-proxy do catálogo.');
}

console.log(JSON.stringify({
  ok: true,
  products: catalog.products.length,
  logicalImages,
  uniqueImages: uniqueIds.size,
  storageMode: catalog.storage.mode,
  publicBase: catalog.storage.publicBase,
  supplierLeak: false,
  repositoryMedia: false
}, null, 2));
