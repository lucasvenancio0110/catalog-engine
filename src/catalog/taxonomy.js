function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export function createTaxonomyModel(taxonomy = [], products = []) {
  const byId = new Map(taxonomy.map((category) => [String(category.id), category]));
  const directCounts = new Map();

  for (const product of products) {
    if (!product?.categoryId) continue;
    directCounts.set(product.categoryId, (directCounts.get(product.categoryId) || 0) + 1);
  }

  function descendants(categoryId, seen = new Set()) {
    if (!categoryId || seen.has(categoryId)) return [];
    seen.add(categoryId);
    const category = byId.get(categoryId);
    if (!category) return [];
    const children = (category.childIds || []).filter((id) => byId.has(id));
    return [categoryId, ...children.flatMap((childId) => descendants(childId, seen))];
  }

  function count(categoryId) {
    return descendants(categoryId).reduce((sum, id) => sum + (directCounts.get(id) || 0), 0);
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
    const accepted = new Set(descendants(categoryId));
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
