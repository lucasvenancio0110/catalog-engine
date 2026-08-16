import { readFile, writeFile } from 'node:fs/promises';
import { scanYupooTaxonomy } from './yupoo-taxonomy.mjs';
import { enrichPublicCatalogTaxonomy } from './public-taxonomy.mjs';

const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const sourceStatePath = process.env.SOURCE_STATE_PATH || 'data/source-state.json';

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const sourceState = JSON.parse(await readFile(sourceStatePath, 'utf8'));
const sourceUrl = sourceState.source;

if (!sourceUrl) throw new Error('source-state não contém URL da fonte para ler a taxonomia.');

const scan = await scanYupooTaxonomy(sourceUrl);
const enriched = enrichPublicCatalogTaxonomy({
  provider: 'yupoo',
  catalog,
  sourceState,
  rawTaxonomy: scan.categories
});

await writeFile(catalogPath, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  schemaVersion: enriched.schemaVersion,
  taxonomy: enriched.taxonomyStats,
  products: enriched.products.length,
  categorizedProducts: enriched.products.filter((product) => product.categoryId).length,
  productsWithHierarchy: enriched.products.filter((product) => (product.categoryPathIds || []).length > 1).length
}, null, 2));
