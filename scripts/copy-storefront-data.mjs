import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const catalogSource = resolve(root, 'data/catalog.json');
const catalogTarget = resolve(dist, 'data/catalog.json');
const assetsSource = resolve(root, 'assets');
const assetsTarget = resolve(dist, 'assets');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(catalogSource))) {
  throw new Error('data/catalog.json não existe. Gere/importe um catálogo antes do build.');
}

const catalog = JSON.parse(await readFile(catalogSource, 'utf8'));
await mkdir(resolve(dist, 'data'), { recursive: true });
await cp(catalogSource, catalogTarget, { force: true });

// Repository-backed media is staged into dist only while the catalog still uses it.
// Edge-proxy catalogs expose /media/<opaque-id> through the Worker and must not
// publish supplier images as static build assets.
if (catalog.storage?.mode !== 'edge-proxy' && (await exists(assetsSource))) {
  await cp(assetsSource, assetsTarget, { recursive: true, force: true });
}

await writeFile(resolve(dist, '.nojekyll'), '', 'utf8');
console.log(`Storefront data staged into dist/ (${catalog.storage?.mode || 'repository'} media).`);
