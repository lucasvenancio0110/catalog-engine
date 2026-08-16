import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const required = ['index.html', 'data/catalog.json', '.nojekyll'];
for (const path of required) {
  if (!(await exists(resolve(dist, path)))) throw new Error(`Build incompleto: dist/${path} ausente.`);
}

for (const privatePath of ['data/source-state.json', 'data/sync-state.json', 'data/media-manifest.json']) {
  if (await exists(resolve(dist, privatePath))) {
    throw new Error(`Build público contém estado que não deve ir para o navegador: dist/${privatePath}.`);
  }
}

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (/src\/(?:main|entry)\.js|app\.js|styles\.css/.test(html)) {
  throw new Error('index.html de produção ainda referencia arquivos fonte/legados em vez dos bundles do Vite.');
}

const bundleDir = resolve(dist, 'assets');
if (!(await exists(bundleDir))) throw new Error('Build sem dist/assets.');
const bundleFiles = await readdir(bundleDir);
const hasJsBundle = bundleFiles.some((name) => /\.js$/.test(name));
const hasCssBundle = bundleFiles.some((name) => /\.css$/.test(name));
if (!hasJsBundle || !hasCssBundle) throw new Error('Bundles JS/CSS do Vite não foram encontrados.');

const catalogText = await readFile(resolve(dist, 'data/catalog.json'), 'utf8');
if (/x\.yupoo\.com|photo\.yupoo\.com/i.test(catalogText)) {
  throw new Error('White-label violation: URL do fornecedor encontrada no catálogo público do dist.');
}

const catalog = JSON.parse(catalogText);
if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
  throw new Error('Catálogo público sem produtos.');
}

if (catalog.schemaVersion >= 4) {
  if (catalog.products.some((product) => !/^p_[a-f0-9]{20}$/.test(String(product.id)))) {
    throw new Error('Build público contém produto com ID não opaco.');
  }
  if ((catalog.taxonomy || []).some((category) => !/^c_[a-f0-9]{20}$/.test(String(category.id)))) {
    throw new Error('Build público contém categoria com ID não opaco.');
  }
}

if (catalog.schemaVersion >= 6 && await exists(resolve(dist, 'assets/catalog'))) {
  throw new Error('Build schema 6 ainda contém a árvore legada assets/catalog.');
}

let checkedImages = 0;
let checkedMediaFiles = 0;
for (const product of catalog.products) {
  if (catalog.schemaVersion >= 6) {
    if (!Array.isArray(product.media) || product.media.length !== product.images?.length) {
      throw new Error(`Build schema 6 sem rich media alinhado no produto ${product.id}.`);
    }
  }

  for (let index = 0; index < (product.images || []).length; index += 1) {
    const image = product.images[index];
    if (typeof image !== 'string' || !image.startsWith('./assets/')) {
      throw new Error(`Imagem pública com caminho inválido no produto ${product.id || product.name}.`);
    }

    if (catalog.schemaVersion >= 6) {
      const media = product.media[index];
      if (!image.startsWith('./assets/media/web/') || media.url !== image) {
        throw new Error(`Imagem web divergente no produto ${product.id}.`);
      }
      for (const url of [media.url, media.thumbnailUrl, media.downloadUrl]) {
        const mediaPath = resolve(dist, url.replace(/^\.\//, ''));
        if (!(await exists(mediaPath))) throw new Error(`Arquivo de mídia ausente no dist: ${url}`);
        checkedMediaFiles += 1;
      }
    } else {
      if (catalog.schemaVersion >= 4 && !image.includes(`/assets/catalog/${product.id}/`)) {
        throw new Error(`Imagem pública fora do namespace opaco do produto ${product.id}.`);
      }
      const imagePath = resolve(dist, image.replace(/^\.\//, ''));
      if (!(await exists(imagePath))) throw new Error(`Imagem referenciada mas ausente no dist: ${image}`);
      checkedMediaFiles += 1;
    }
    checkedImages += 1;
  }
}

if (checkedImages === 0) throw new Error('Nenhuma imagem de produto foi validada no dist.');

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  products: catalog.products.length,
  checkedImages,
  checkedMediaFiles,
  jsBundle: true,
  cssBundle: true,
  supplierLeak: false,
  privateStatePublished: false,
  opaqueIds: catalog.schemaVersion >= 4,
  contentAddressedMedia: catalog.schemaVersion >= 6,
  baseStrategy: 'relative'
}, null, 2));
