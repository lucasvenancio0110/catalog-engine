import {
  assertCatalogProviderPreviewSeedObservation,
  defineCatalogProvider
} from '../../../src/catalog-provider/provider-contract.js';
import { yupooSourceProvider } from '../../../src/catalog-provider/yupoo-source.js';
import { sha256Hex } from '../../runtime-identity.js';
import { fetchYupooAlbumDetailWorker, mediaId as yupooMediaId } from '../yupoo-detail.js';
import { scanYupooListingIndex } from '../yupoo-listing.js';
import {
  constructionSeedFromYupooListingRows,
  previewSeedYupoo
} from '../yupoo-preview-seed.js';

const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const CATEGORY_PATH_PATTERN = /\/categories\/\d+\/?$/i;
const PROGRESSIVE_CONSTRUCTION_MAX_ITEMS = 48;

async function publicCategoryId(sourceId) {
  const digest = await sha256Hex(
    `${PUBLIC_ID_NAMESPACE}|${yupooSourceProvider.key}|${String(sourceId)}`
  );
  return `c_${digest.slice(0, 20)}`;
}

async function fetchDetail({ itemUrl, sourceUrl }, options = {}) {
  return fetchYupooAlbumDetailWorker(itemUrl, sourceUrl, options);
}

async function previewSeed(sourceUrl, options = {}) {
  return assertCatalogProviderPreviewSeedObservation(
    await previewSeedYupoo(sourceUrl, options)
  );
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

export function galleryCategoryFetch(fetchImpl = fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('catalog_provider_fetch_invalid');
  return async (input, init) => {
    const url = new URL(String(input));
    if (CATEGORY_PATH_PATTERN.test(url.pathname) && !url.searchParams.has('tab')) {
      url.searchParams.set('tab', 'gallery');
    }
    return fetchImpl(url.href, init);
  };
}

function nextProgressiveRows(batch, seen) {
  if (!Array.isArray(batch?.items) || batch.items.length === 0) return [];
  if (seen.size >= PROGRESSIVE_CONSTRUCTION_MAX_ITEMS) return [];

  const rows = [];
  for (const row of batch.items) {
    const sourceId = String(row?.sourceId || '').trim();
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    rows.push(row);
    if (seen.size >= PROGRESSIVE_CONSTRUCTION_MAX_ITEMS) break;
  }
  return rows;
}

async function scanListingIndex(sourceUrl, options = {}) {
  const { onPageBatch, fetchImpl = fetch, ...scanOptions } = options;
  const progressiveSeen = new Set();
  const progressiveCallback =
    typeof onPageBatch === 'function'
      ? async (batch) => {
          const rows = nextProgressiveRows(batch, progressiveSeen);
          if (!rows.length) return;
          const seed = assertCatalogProviderPreviewSeedObservation(
            await constructionSeedFromYupooListingRows(sourceUrl, rows, {
              maxItems: rows.length
            })
          );
          await onPageBatch({
            complete: false,
            page: Number(batch.page || 0),
            categoryId: batch.categoryId ? String(batch.categoryId) : null,
            seed
          });
        }
      : null;
  const scan = await scanYupooListingIndex(sourceUrl, {
    ...scanOptions,
    fetchImpl: galleryCategoryFetch(fetchImpl),
    onPageBatch: progressiveCallback
  });
  return normalizeYupooScanTaxonomy(scan);
}

function publicTextLeakPatterns() {
  return ['x.yupoo.com', 'photo.yupoo.com'];
}

export const yupooIngestionProvider = defineCatalogProvider({
  ...yupooSourceProvider,
  previewSeed,
  scanListingIndex,
  fetchDetail,
  publicCategoryId,
  mediaId: yupooMediaId,
  publicTextLeakPatterns
});
