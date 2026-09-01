const FILTER_KEYS = ['teamId', 'leagueId', 'facetId'];
const SORT_VALUES = new Set(['catalog', 'name-asc', 'name-desc']);
const MAX_QUERY_LENGTH = 120;
const MAX_FILTER_LENGTH = 96;

function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function normalizePage(value) {
  const page = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function normalizeFilter(value) {
  const filter = String(value || '').trim();
  if (!filter || filter.length > MAX_FILTER_LENGTH) return '';
  return /^[a-zA-Z0-9_-]+$/.test(filter) ? filter : '';
}

function normalizeSort(value) {
  const sort = String(value || '').trim();
  return SORT_VALUES.has(sort) ? sort : 'catalog';
}

function asUrl(input) {
  if (input instanceof URL) return new URL(input.href);
  return new URL(String(input), 'https://storefront.invalid');
}

export function readCatalogUrlState(input) {
  const url = asUrl(input);
  const filters = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, normalizeFilter(url.searchParams.get(key))])
  );
  return {
    query: normalizeQuery(url.searchParams.get('q')),
    page: normalizePage(url.searchParams.get('page')),
    sort: normalizeSort(url.searchParams.get('sort')),
    filters
  };
}

export function buildCatalogUrl(input, catalogState) {
  const url = asUrl(input);
  url.search = '';

  const query = normalizeQuery(catalogState?.query);
  const page = normalizePage(catalogState?.page);
  const sort = normalizeSort(catalogState?.sort);
  if (query) url.searchParams.set('q', query);
  for (const key of FILTER_KEYS) {
    const value = normalizeFilter(catalogState?.filters?.[key]);
    if (value) url.searchParams.set(key, value);
  }
  if (sort !== 'catalog') url.searchParams.set('sort', sort);
  if (page > 1) url.searchParams.set('page', String(page));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function hasCatalogRefinement(catalogState) {
  return Boolean(
    normalizeQuery(catalogState?.query) ||
    FILTER_KEYS.some((key) => normalizeFilter(catalogState?.filters?.[key]))
  );
}

export const catalogUrlStateLimits = Object.freeze({
  maxQueryLength: MAX_QUERY_LENGTH,
  maxFilterLength: MAX_FILTER_LENGTH,
  sorts: Object.freeze([...SORT_VALUES])
});
