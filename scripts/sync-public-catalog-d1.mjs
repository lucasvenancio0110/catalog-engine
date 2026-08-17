import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const catalogPath = process.env.CATALOG_PATH || 'data/catalog.json';
const sqlDir = process.env.PUBLIC_CATALOG_SQL_DIR || '/tmp/catalog-engine-public-api-sql';
const chunkStatements = Math.max(
  250,
  Number(process.env.PUBLIC_CATALOG_SQL_CHUNK_STATEMENTS || 900)
);

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeSearch(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
}

async function writeSqlChunks(statements) {
  await rm(sqlDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true });

  const files = [];
  for (let index = 0; index < statements.length; index += chunkStatements) {
    const chunk = statements.slice(index, index + chunkStatements);
    const path = resolve(sqlDir, `${String(files.length + 1).padStart(4, '0')}.sql`);
    await writeFile(
      path,
      `PRAGMA foreign_keys = ON;\nBEGIN;\n${chunk.join('\n')}\nCOMMIT;\n`,
      'utf8'
    );
    files.push(path);
  }
  return files;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const products = Array.isArray(catalog.products) ? catalog.products : [];
const taxonomy = Array.isArray(catalog.taxonomy) ? catalog.taxonomy : [];

if (!products.length) throw new Error('O catálogo público não possui produtos para sincronizar no D1.');
if (!taxonomy.length) throw new Error('O catálogo público não possui taxonomia para sincronizar no D1.');

const categoryNameById = new Map(taxonomy.map((category) => [category.id, category.name]));
const productCountByCategory = new Map();
for (const product of products) {
  const categoryIds = [...new Set(product.categoryPathIds || [])];
  for (const categoryId of categoryIds) {
    productCountByCategory.set(categoryId, (productCountByCategory.get(categoryId) || 0) + 1);
  }
}

const statements = [
  'DELETE FROM catalog_product_categories;',
  'DELETE FROM catalog_products;',
  'DELETE FROM catalog_categories;',
  'DELETE FROM catalog_meta;'
];

for (const [index, category] of taxonomy.entries()) {
  statements.push(
    `INSERT INTO catalog_categories (category_id, name, parent_id, depth, sort_order, product_count, updated_at) VALUES (` +
      `${sqlString(category.id)}, ${sqlString(category.name)}, ${sqlString(category.parentId)}, ` +
      `${Math.max(0, Number(category.depth || 0))}, ${index}, ${productCountByCategory.get(category.id) || 0}, CURRENT_TIMESTAMP);`
  );
}

for (const [index, product] of products.entries()) {
  const primaryMediaId = product.media?.[0]?.id || null;
  const imageCount = Math.max(0, Number(product.imageCount || product.media?.length || 0));
  const categoryPathNames = (product.categoryPathIds || [])
    .map((categoryId) => categoryNameById.get(categoryId))
    .filter(Boolean);
  const searchText = normalizeSearch(
    [product.name, product.category, ...categoryPathNames, product.description]
      .filter(Boolean)
      .join(' ')
  );

  statements.push(
    `INSERT INTO catalog_products (` +
      `product_id, name, search_text, category_id, category_name, description, image_count, primary_media_id, sort_order, updated_at` +
      `) VALUES (` +
      `${sqlString(product.id)}, ${sqlString(product.name)}, ${sqlString(searchText)}, ` +
      `${sqlString(product.categoryId)}, ${sqlString(product.category)}, ${sqlString(product.description || '')}, ` +
      `${imageCount}, ${sqlString(primaryMediaId)}, ${index}, CURRENT_TIMESTAMP);`
  );

  for (const categoryId of [...new Set(product.categoryPathIds || [])]) {
    statements.push(
      `INSERT INTO catalog_product_categories (product_id, category_id) VALUES (` +
        `${sqlString(product.id)}, ${sqlString(categoryId)});`
    );
  }
}

const meta = {
  store: catalog.store || {},
  generatedAt: catalog.generatedAt || new Date().toISOString(),
  stats: {
    ...(catalog.stats || {}),
    products: products.length
  },
  storage: catalog.storage || {}
};

for (const [key, value] of Object.entries(meta)) {
  statements.push(
    `INSERT INTO catalog_meta (key, value_json, updated_at) VALUES (` +
      `${sqlString(key)}, ${sqlString(JSON.stringify(value))}, CURRENT_TIMESTAMP);`
  );
}

const files = await writeSqlChunks(statements);
console.log(
  JSON.stringify(
    {
      ok: true,
      products: products.length,
      categories: taxonomy.length,
      categoryLinks: products.reduce(
        (sum, product) => sum + new Set(product.categoryPathIds || []).size,
        0
      ),
      sqlChunks: files.length,
      sqlDir
    },
    null,
    2
  )
);
