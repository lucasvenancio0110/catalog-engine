const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PREVIEW_PRODUCT_ID_PATTERN = /^p_[a-f0-9]{20}$/;
const PREVIEW_MEDIA_ID_PATTERN = /^cm_[a-f0-9]{20}$/;
const PREVIEW_SEED_ID_PATTERN = /^cs_[a-f0-9]{20}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{32,128}$/;

export const CATALOG_PROVIDER_CONTRACT_VERSION = 1;

export class CatalogProviderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CatalogProviderError';
    this.code = code;
  }
}

export function normalizeCatalogProviderKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!PROVIDER_KEY_PATTERN.test(key)) {
    throw new CatalogProviderError('catalog_provider_key_invalid');
  }
  return key;
}

export function defineCatalogProvider(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new CatalogProviderError('catalog_provider_definition_invalid');
  }
  const key = normalizeCatalogProviderKey(definition.key);
  const provider = {
    contractVersion: CATALOG_PROVIDER_CONTRACT_VERSION,
    ...definition,
    key
  };
  return Object.freeze(provider);
}

export function requireCatalogProviderCapabilities(provider, capabilities = []) {
  for (const capability of capabilities) {
    if (typeof provider?.[capability] !== 'function') {
      throw new CatalogProviderError('catalog_provider_capability_missing');
    }
  }
  return provider;
}

export function createCatalogProviderRegistry(
  providers,
  { unsupportedCode = 'catalog_provider_not_supported' } = {}
) {
  const byKey = new Map();
  for (const provider of providers || []) {
    const normalized = defineCatalogProvider(provider);
    if (byKey.has(normalized.key)) {
      throw new CatalogProviderError('catalog_provider_duplicate');
    }
    byKey.set(normalized.key, normalized);
  }

  function get(key, capabilities = []) {
    let normalizedKey;
    try {
      normalizedKey = normalizeCatalogProviderKey(key);
    } catch {
      throw new CatalogProviderError(unsupportedCode);
    }
    const provider = byKey.get(normalizedKey);
    if (!provider) throw new CatalogProviderError(unsupportedCode);
    return requireCatalogProviderCapabilities(provider, capabilities);
  }

  function detectSource(sourceUrl) {
    const matches = [...byKey.values()].filter(
      (provider) => typeof provider.canHandleSource === 'function' && provider.canHandleSource(sourceUrl)
    );
    if (matches.length !== 1) throw new CatalogProviderError(unsupportedCode);
    return requireCatalogProviderCapabilities(matches[0], ['normalizeSource']);
  }

  return Object.freeze({
    keys: Object.freeze([...byKey.keys()]),
    get,
    detectSource
  });
}

export function assertCatalogProviderScanObservation(result) {
  if (
    !result ||
    typeof result.complete !== 'boolean' ||
    !Array.isArray(result.items) ||
    !Array.isArray(result.taxonomy)
  ) {
    throw new CatalogProviderError('catalog_provider_scan_contract_invalid');
  }
  for (const item of result.items) {
    if (
      !item ||
      !String(item.albumSourceId || '').trim() ||
      !String(item.publicProductId || '').trim() ||
      !String(item.sourceUrl || '').trim() ||
      !String(item.listingFingerprint || '').trim()
    ) {
      throw new CatalogProviderError('catalog_provider_scan_contract_invalid');
    }
  }
  return result;
}

export function assertCatalogProviderScanResult(result) {
  const observation = assertCatalogProviderScanObservation(result);
  if (observation.complete !== true) {
    throw new CatalogProviderError('catalog_provider_scan_contract_invalid');
  }
  return observation;
}

function isPrivateHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function assertCatalogProviderPreviewSeedObservation(result) {
  if (
    !result ||
    result.complete !== false ||
    result.readiness !== 'indexed' ||
    !PREVIEW_SEED_ID_PATTERN.test(String(result.seedId || '')) ||
    !Number.isFinite(Date.parse(String(result.observedAt || ''))) ||
    !Array.isArray(result.items) ||
    result.items.length < 1 ||
    result.items.length > 48
  ) {
    throw new CatalogProviderError('catalog_provider_preview_seed_contract_invalid');
  }

  for (const item of result.items) {
    if (
      !item ||
      !PREVIEW_PRODUCT_ID_PATTERN.test(String(item.productId || '')) ||
      !String(item.title || '').trim() ||
      String(item.title).length > 160 ||
      !FINGERPRINT_PATTERN.test(String(item.listingFingerprint || '')) ||
      !isPrivateHttpsUrl(item.sourceItemUrl) ||
      !Array.isArray(item.categories) ||
      item.categories.length > 4
    ) {
      throw new CatalogProviderError('catalog_provider_preview_seed_contract_invalid');
    }
    if (
      item.cover &&
      (!PREVIEW_MEDIA_ID_PATTERN.test(String(item.cover.mediaId || '')) ||
        !isPrivateHttpsUrl(item.cover.sourceUrl))
    ) {
      throw new CatalogProviderError('catalog_provider_preview_seed_contract_invalid');
    }
  }
  return result;
}

export function assertCatalogProviderDetailResult(result) {
  if (
    !result ||
    typeof result.name !== 'string' ||
    typeof result.description !== 'string' ||
    !Array.isArray(result.images) ||
    !result.classification ||
    !String(result.classification.entityType || '').trim() ||
    !String(result.detailFingerprint || '').trim()
  ) {
    throw new CatalogProviderError('catalog_provider_detail_contract_invalid');
  }
  for (const image of result.images) {
    if (!String(image?.sourceUrl || '').trim()) {
      throw new CatalogProviderError('catalog_provider_detail_contract_invalid');
    }
  }
  return result;
}
