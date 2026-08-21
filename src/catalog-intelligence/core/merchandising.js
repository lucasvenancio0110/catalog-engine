const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,95}$/;
const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;
const TARGET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MAX_NAVIGATION_ITEMS = 64;

export const CEI_MERCHANDISING_CONTRACT_VERSION = 1;

function boundedLabel(value, code) {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 120 || /https?:\/\/|x\.yupoo\.com|photo\.yupoo\.com/i.test(label)) {
    throw new Error(code);
  }
  return label;
}

function safeKey(value, pattern, code) {
  const key = String(value || '').trim().toLowerCase();
  if (!pattern.test(key)) throw new Error(code);
  return key;
}

function navigationItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('cei_merchandising_navigation_invalid');
  }
  const sortOrder = Number(value.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    throw new Error('cei_merchandising_sort_order_invalid');
  }

  const item = {
    id: safeKey(value.id, ITEM_ID_PATTERN, 'cei_merchandising_item_id_invalid'),
    name: boundedLabel(value.name, 'cei_merchandising_item_name_invalid'),
    kind: safeKey(value.kind, KIND_PATTERN, 'cei_merchandising_item_kind_invalid'),
    sortOrder
  };

  if (value.facetId !== undefined && value.facetId !== null) {
    item.facetId = safeKey(
      value.facetId,
      TARGET_ID_PATTERN,
      'cei_merchandising_facet_id_invalid'
    );
  }
  if (value.entityType !== undefined && value.entityType !== null) {
    item.entityType = safeKey(
      value.entityType,
      TARGET_ID_PATTERN,
      'cei_merchandising_entity_type_invalid'
    );
  }
  return Object.freeze(item);
}

export function defineMerchandising({ navigation = [] } = {}) {
  if (!Array.isArray(navigation) || navigation.length > MAX_NAVIGATION_ITEMS) {
    throw new Error('cei_merchandising_navigation_invalid');
  }
  const ids = new Set();
  const items = navigation.map((value) => {
    const item = navigationItem(value);
    if (ids.has(item.id)) throw new Error('cei_merchandising_navigation_duplicate');
    ids.add(item.id);
    return item;
  });
  items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return Object.freeze({
    contractVersion: CEI_MERCHANDISING_CONTRACT_VERSION,
    navigation: Object.freeze(items)
  });
}

export function knowledgePackNavigation(knowledgePack) {
  const merchandising = knowledgePack?.merchandising;
  if (
    !merchandising ||
    merchandising.contractVersion !== CEI_MERCHANDISING_CONTRACT_VERSION ||
    !Array.isArray(merchandising.navigation)
  ) {
    return Object.freeze([]);
  }
  return merchandising.navigation;
}

export function materializeMerchandisingNavigation(
  knowledgePack,
  countResolver = () => null,
  { includeZero = false } = {}
) {
  if (typeof countResolver !== 'function') {
    throw new Error('cei_merchandising_count_resolver_invalid');
  }
  const output = [];
  for (const item of knowledgePackNavigation(knowledgePack)) {
    const rawCount = countResolver(item);
    const numericCount = rawCount === null || rawCount === undefined ? null : Number(rawCount);
    if (numericCount !== null && (!Number.isFinite(numericCount) || numericCount < 0)) {
      throw new Error('cei_merchandising_count_invalid');
    }
    const count = numericCount === null ? null : Math.trunc(numericCount);
    if (!includeZero && count !== null && count < 1) continue;
    output.push(
      Object.freeze({
        ...item,
        ...(count === null ? {} : { count })
      })
    );
  }
  return Object.freeze(output);
}
