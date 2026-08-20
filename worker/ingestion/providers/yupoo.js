import { defineCatalogProvider } from '../../../src/catalog-provider/provider-contract.js';
import { yupooSourceProvider } from '../../../src/catalog-provider/yupoo-source.js';
import { sha256Hex } from '../../runtime-identity.js';
import { fetchYupooAlbumDetailWorker, mediaId as yupooMediaId } from '../yupoo-detail.js';
import { scanYupooListingIndex } from '../yupoo-listing.js';

const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';

async function publicCategoryId(sourceId) {
  const digest = await sha256Hex(
    `${PUBLIC_ID_NAMESPACE}|${yupooSourceProvider.key}|${String(sourceId)}`
  );
  return `c_${digest.slice(0, 20)}`;
}

async function fetchDetail({ itemUrl, sourceUrl }, options = {}) {
  return fetchYupooAlbumDetailWorker(itemUrl, sourceUrl, options);
}

function publicTextLeakPatterns() {
  return ['x.yupoo.com', 'photo.yupoo.com'];
}

export const yupooIngestionProvider = defineCatalogProvider({
  ...yupooSourceProvider,
  scanListingIndex: scanYupooListingIndex,
  fetchDetail,
  publicCategoryId,
  mediaId: yupooMediaId,
  publicTextLeakPatterns
});
