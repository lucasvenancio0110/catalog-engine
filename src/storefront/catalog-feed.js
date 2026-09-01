export function mergeCatalogProductBatch(currentProducts = [], incomingProducts = []) {
  const merged = [];
  const added = [];
  const seen = new Set();

  for (const product of currentProducts) {
    const id = String(product?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(product);
  }

  for (const product of incomingProducts) {
    const id = String(product?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(product);
    added.push(product);
  }

  return { items: merged, added };
}

export function catalogFeedRange({ startPage = 1, pageSize = 15, loadedCount = 0, total = 0 } = {}) {
  const safePage = Math.max(1, Number.parseInt(String(startPage || 1), 10) || 1);
  const safePageSize = Math.max(1, Number.parseInt(String(pageSize || 15), 10) || 15);
  const safeLoadedCount = Math.max(0, Number.parseInt(String(loadedCount || 0), 10) || 0);
  const safeTotal = Math.max(0, Number.parseInt(String(total || 0), 10) || 0);
  const start = safeLoadedCount ? (safePage - 1) * safePageSize + 1 : 0;
  const end = safeLoadedCount ? Math.min(start + safeLoadedCount - 1, safeTotal || Infinity) : 0;
  return { start, end, total: safeTotal };
}

export function canLoadNextCatalogPage({
  loading = false,
  loadingMore = false,
  error = null,
  loadMoreError = null,
  hasMore = false
} = {}) {
  return Boolean(hasMore && !loading && !loadingMore && !error && !loadMoreError);
}
