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

function categoryIdentity(category) {
  return String(category?.id ?? category?.categorySourceId ?? '').trim();
}

export function normalizeYupooScanTaxonomy(scan) {
  if (!scan || !Array.isArray(scan.taxonomy)) return scan;
  const byId = new Map();
  for (const category of scan.taxonomy) {
    const id = categoryIdentity(category);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, category);
  }
  if (byId.size === scan.taxonomy.length) return scan;
  return {
    ...scan,
    taxonomy: [...byId.values()]
  };
}

async function scanListingIndex(sourceUrl, options = {}) {
  const scan = await scanYupooListingIndex(sourceUrl, options);
  return normalizeYupooScanTaxonomy(scan);
}

function publicTextLeakPatterns() {
  return ['x.yupoo.com', 'photo.yupoo.com'];
}

export const yupooIngestionProvider = defineCatalogProvider({
  ...yupooSourceProvider,
  scanListingIndex,
  fetchDetail,
  publicCategoryId,
  mediaId: yupooMediaId,
  publicTextLeakPatterns
});
