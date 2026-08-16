import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const categoryPattern = /^c_[a-f0-9]{20}$/;

if (catalog.schemaVersion < 5) throw new Error('Taxonomy audit exige catalog schemaVersion >= 5.');
if (!Array.isArray(catalog.taxonomy) || !catalog.taxonomy.length) throw new Error('Taxonomia pública vazia.');
if (!Array.isArray(catalog.products) || !catalog.products.length) throw new Error('Catálogo sem produtos.');

const byId = new Map();
for (const category of catalog.taxonomy) {
  if (!categoryPattern.test(String(category.id))) throw new Error(`Categoria com ID não opaco: ${category.id}`);
  if (byId.has(category.id)) throw new Error(`Categoria duplicada: ${category.id}`);
  if (!category.name) throw new Error(`Categoria sem nome: ${category.id}`);
  if (!Array.isArray(category.childIds)) throw new Error(`Categoria sem childIds: ${category.id}`);
  if (!Number.isInteger(category.depth) || category.depth < 0) throw new Error(`Depth inválido: ${category.id}`);
  byId.set(category.id, category);
}

for (const category of catalog.taxonomy) {
  if (category.parentId) {
    const parent = byId.get(category.parentId);
    if (!parent) throw new Error(`Parent inexistente em ${category.id}: ${category.parentId}`);
    if (!parent.childIds.includes(category.id)) throw new Error(`Relação pai/filho não recíproca: ${category.parentId} → ${category.id}`);
    if (category.depth !== parent.depth + 1) throw new Error(`Depth inconsistente: ${category.id}`);
  } else if (category.depth !== 0) {
    throw new Error(`Categoria raiz com depth diferente de 0: ${category.id}`);
  }

  const uniqueChildren = new Set(category.childIds);
  if (uniqueChildren.size !== category.childIds.length) throw new Error(`Filhos duplicados em ${category.id}`);
  for (const childId of category.childIds) {
    const child = byId.get(childId);
    if (!child) throw new Error(`Child inexistente em ${category.id}: ${childId}`);
    if (child.parentId !== category.id) throw new Error(`Relação filho/pai não recíproca: ${category.id} → ${childId}`);
  }
}

let hierarchicalProducts = 0;
for (const product of catalog.products) {
  if (!categoryPattern.test(String(product.categoryId || ''))) {
    throw new Error(`Produto sem categoryId opaco: ${product.id}`);
  }
  if (!byId.has(product.categoryId)) throw new Error(`Produto aponta para categoria inexistente: ${product.id}`);
  if (!Array.isArray(product.categoryPathIds) || !product.categoryPathIds.length) {
    throw new Error(`Produto sem categoryPathIds: ${product.id}`);
  }
  if (product.categoryPathIds.at(-1) !== product.categoryId) {
    throw new Error(`categoryPathIds não termina na categoria do produto: ${product.id}`);
  }
  if (product.categoryPathIds.some((id) => !byId.has(id))) {
    throw new Error(`Produto contém categoria inexistente no caminho: ${product.id}`);
  }

  for (let index = 1; index < product.categoryPathIds.length; index += 1) {
    const parent = byId.get(product.categoryPathIds[index - 1]);
    const child = byId.get(product.categoryPathIds[index]);
    if (child.parentId !== parent.id) throw new Error(`Caminho hierárquico quebrado no produto ${product.id}`);
  }
  if (product.categoryPathIds.length > 1) hierarchicalProducts += 1;
}

const roots = catalog.taxonomy.filter((category) => !category.parentId);
const nested = catalog.taxonomy.filter((category) => category.parentId);
const used = new Set(catalog.products.flatMap((product) => product.categoryPathIds));

console.log(JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  taxonomyVersion: catalog.taxonomyVersion,
  total: catalog.taxonomy.length,
  roots: roots.length,
  nested: nested.length,
  maxDepth: Math.max(...catalog.taxonomy.map((category) => category.depth)),
  usedCategories: used.size,
  products: catalog.products.length,
  hierarchicalProducts
}, null, 2));
