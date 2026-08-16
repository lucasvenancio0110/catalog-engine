function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export function createTaxonomyModel(taxonomy = [], products = []) {
  const byId = new Map(taxonomy.map((category) => [String(category.id), category]));
  const directCounts = new Map();
  const descendantCache = new Map();
  const countCache = new Map();

  for (const product of products) {
    if (!product?.categoryId) continue;
    directCounts.set(product.categoryId, (directCounts.get(product.categoryId) || 0) + 1);
  }

  function computeDescendants(categoryId, visiting = new Set()) {
    if (!categoryId || visiting.has(categoryId)) return [];
    if (descendantCache.has(categoryId)) return descendantCache.get(categoryId);

    const category = byId.get(categoryId);
    if (!category) return [];

    const nextVisiting = new Set(visiting);
    nextVisiting.add(categoryId);
    const children = (category.childIds || []).filter((id) => byId.has(id));
    const ids = [
      categoryId,
      ...children.flatMap((childId) => computeDescendants(childId, nextVisiting))
    ];
    const unique = [...new Set(ids)];
    descendantCache.set(categoryId, unique);
    return unique;
  }

  function descendants(categoryId) {
    return [...computeDescendants(categoryId)];
  }

  function count(categoryId) {
    if (countCache.has(categoryId)) return countCache.get(categoryId);
    const total = computeDescendants(categoryId).reduce(
      (sum, id) => sum + (directCounts.get(id) || 0),
      0
    );
    countCache.set(categoryId, total);
    return total;
  }

  function children(categoryId) {
    const category = byId.get(categoryId);
    if (!category) return [];
    return (category.childIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((child) => count(child.id) > 0)
      .sort((a, b) => count(b.id) - count(a.id) || byName(a, b));
  }

  function roots() {
    return taxonomy
      .filter((category) => !category.parentId || !byId.has(category.parentId))
      .filter((category) => count(category.id) > 0)
      .sort((a, b) => count(b.id) - count(a.id) || byName(a, b));
  }

  function trail(categoryId) {
    const output = [];
    const seen = new Set();
    let current = byId.get(categoryId);
    while (current && !seen.has(current.id)) {
      output.unshift(current);
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    return output;
  }

  function productMatches(product, categoryId) {
    if (!categoryId) return true;
    const accepted = new Set(computeDescendants(categoryId));
    if (product.categoryId && accepted.has(product.categoryId)) return true;
    return (product.categoryPathIds || []).some((id) => accepted.has(id));
  }

  return {
    byId,
    roots,
    children,
    trail,
    count,
    descendants,
    productMatches
  };
}
