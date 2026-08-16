import { publicCategoryId } from './catalog-sync.mjs';

const UNCATEGORIZED_SOURCE_ID = '__catalog_engine_uncategorized__';

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function uniqueNameIndex(categories = []) {
  const groups = new Map();
  for (const category of categories) {
    const key = normalize(category.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(category);
  }
  return new Map(
    [...groups.entries()]
      .filter(([, values]) => values.length === 1)
      .map(([key, values]) => [key, values[0]])
  );
}

function sanitizeCategory(provider, category) {
  return {
    id: publicCategoryId(provider, category.id),
    type: 'category',
    name: clean(category.name),
    parentId: category.parentId ? publicCategoryId(provider, category.parentId) : null,
    childIds: Array.isArray(category.childIds)
      ? category.childIds.map((id) => publicCategoryId(provider, id))
      : [],
    depth: Number.isInteger(category.depth) ? category.depth : 0
  };
}

function findSourceCategory(sourceProduct, publicProduct, rawById, rawByUniqueName) {
  const sourceId = clean(sourceProduct?.sourceCategoryId);
  if (sourceId && rawById.has(sourceId)) return rawById.get(sourceId);

  const names = [
    sourceProduct?.sourceCategoryName,
    publicProduct?.category
  ].map(normalize).filter(Boolean);

  for (const name of names) {
    const category = rawByUniqueName.get(name);
    if (category) return category;
  }
  return null;
}

function ancestorsFor(category, rawById) {
  const ancestors = [];
  const seen = new Set([category.id]);
  let current = category;

  while (current?.parentId && rawById.has(current.parentId) && !seen.has(current.parentId)) {
    const parent = rawById.get(current.parentId);
    ancestors.unshift(parent);
    seen.add(parent.id);
    current = parent;
  }
  return ancestors;
}

export function enrichPublicCatalogTaxonomy({
  provider = 'yupoo',
  catalog,
  sourceState = {},
  rawTaxonomy = []
} = {}) {
  if (!catalog || !Array.isArray(catalog.products)) {
    throw new Error('Catálogo público inválido para enriquecimento de taxonomia.');
  }

  const validRawTaxonomy = rawTaxonomy.filter((category) => category?.id && clean(category.name));
  const rawById = new Map(validRawTaxonomy.map((category) => [String(category.id), category]));
  const rawByUniqueName = uniqueNameIndex(validRawTaxonomy);
  const sourceByPublicId = new Map(
    (sourceState.products || [])
      .filter((product) => product?.publicId)
      .map((product) => [String(product.publicId), product])
  );
  const existingById = new Map((catalog.taxonomy || []).map((category) => [String(category.id), category]));

  const taxonomy = validRawTaxonomy.map((category) => sanitizeCategory(provider, category));
  const taxonomyByPublicId = new Map(taxonomy.map((category) => [category.id, category]));
  const uncategorizedId = publicCategoryId(provider, UNCATEGORIZED_SOURCE_ID);

  const products = catalog.products.map((product) => {
    const sourceProduct = sourceByPublicId.get(String(product.id));
    const sourceCategory = findSourceCategory(sourceProduct, product, rawById, rawByUniqueName);

    if (sourceCategory) {
      const categoryId = publicCategoryId(provider, sourceCategory.id);
      const ancestorIds = ancestorsFor(sourceCategory, rawById)
        .map((category) => publicCategoryId(provider, category.id));
      return {
        ...product,
        categoryId,
        categoryPathIds: [...ancestorIds, categoryId],
        category: sourceCategory.name
      };
    }

    if (product.categoryId && taxonomyByPublicId.has(product.categoryId)) {
      return product;
    }

    const existingCategory = [...existingById.values()].find(
      (category) => normalize(category.name) === normalize(product.category)
    );
    if (existingCategory && taxonomyByPublicId.has(existingCategory.id)) {
      return {
        ...product,
        categoryId: existingCategory.id,
        categoryPathIds: [existingCategory.id]
      };
    }

    return {
      ...product,
      category: product.category || 'Outros',
      categoryId: uncategorizedId,
      categoryPathIds: [uncategorizedId]
    };
  });

  const needsUncategorized = products.some((product) => product.categoryId === uncategorizedId);
  if (needsUncategorized && !taxonomyByPublicId.has(uncategorizedId)) {
    taxonomy.push({
      id: uncategorizedId,
      type: 'category',
      name: 'Outros',
      parentId: null,
      childIds: [],
      depth: 0
    });
  }

  const usedCategoryIds = new Set(products.flatMap((product) => product.categoryPathIds || []));

  return {
    ...catalog,
    schemaVersion: Math.max(5, Number(catalog.schemaVersion || 0)),
    taxonomyVersion: 1,
    taxonomy,
    taxonomyStats: {
      total: taxonomy.length,
      roots: taxonomy.filter((category) => !category.parentId).length,
      nested: taxonomy.filter((category) => category.parentId).length,
      maxDepth: taxonomy.reduce((max, category) => Math.max(max, category.depth || 0), 0),
      used: usedCategoryIds.size
    },
    products
  };
}
