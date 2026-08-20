import { createCatalogProviderRegistry } from '../../../src/catalog-provider/provider-contract.js';
import { yupooIngestionProvider } from './yupoo.js';

export const catalogIngestionProviders = createCatalogProviderRegistry([yupooIngestionProvider], {
  unsupportedCode: 'tenant_import_provider_not_supported'
});

export function resolveCatalogIngestionProvider(providerKey) {
  return catalogIngestionProviders.get(providerKey, [
    'scanListingIndex',
    'fetchDetail',
    'publicCategoryId',
    'mediaId'
  ]);
}
