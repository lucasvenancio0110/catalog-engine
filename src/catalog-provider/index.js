import { createCatalogProviderRegistry } from './provider-contract.js';
import { yupooSourceProvider } from './yupoo-source.js';

export const catalogSourceProviders = createCatalogProviderRegistry([yupooSourceProvider], {
  unsupportedCode: 'catalog_source_provider_not_supported'
});

export function resolveCatalogSource({ provider = null, sourceUrl }) {
  const adapter = provider
    ? catalogSourceProviders.get(provider, ['normalizeSource'])
    : catalogSourceProviders.detectSource(sourceUrl);
  return {
    provider: adapter,
    normalized: adapter.normalizeSource(sourceUrl)
  };
}

export function normalizeCatalogSourceUrl(provider, sourceUrl) {
  return catalogSourceProviders.get(provider, ['normalizeSource']).normalizeSource(sourceUrl);
}

export { normalizeYupooCatalogUrl, yupooSourceProvider } from './yupoo-source.js';
