import { createHash } from 'node:crypto';
import { planListingDelta } from '../src/sync/listing-delta.js';

const FINGERPRINT_NAMESPACE = 'catalog-engine:supplier-listing:v2';

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function listingFingerprint(entry = {}) {
  // Source placement/category is deliberately excluded. A pure category move must
  // not force a detail fetch; location is compared independently by the planner.
  const payload = {
    title: clean(entry.title),
    coverUrl: clean(entry.coverUrl),
    listingSignal: clean(entry.listingSignal),
    imageCountHint: Number.isFinite(Number(entry.imageCountHint)) ? Number(entry.imageCountHint) : null
  };
  return hash(`${FINGERPRINT_NAMESPACE}|${JSON.stringify(payload)}`);
}

export function flattenWranglerResults(payload) {
  const output = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (Array.isArray(value.results)) output.push(...value.results);
    if (value.result) visit(value.result);
  };
  visit(payload);
  return output;
}

function categoryPathIds(row = {}) {
  if (Array.isArray(row.categoryPathIds)) return row.categoryPathIds.map(String);
  const serialized = clean(row.source_category_path_json ?? row.categoryPathJson);
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizePrevious(row = {}) {
  return {
    sourceId: clean(row.album_source_id ?? row.sourceId),
    publicProductId: clean(row.public_product_id ?? row.publicProductId),
    title: clean(row.source_title ?? row.title),
    categoryId: clean(row.source_category_id ?? row.categoryId) || null,
    categoryPathIds: categoryPathIds(row),
    coverUrl: clean(row.cover_source_url ?? row.coverUrl),
    listingFingerprint: clean(row.listing_fingerprint ?? row.listingFingerprint),
    detailFingerprint: clean(row.detail_fingerprint ?? row.detailFingerprint) || null,
    status: clean(row.status || 'active'),
    missCount: Math.max(0, Number(row.miss_count ?? row.missCount ?? 0)),
    firstSeenAt: clean(row.first_seen_at ?? row.firstSeenAt),
    lastSeenAt: clean(row.last_seen_at ?? row.lastSeenAt),
    lastChangedAt: clean(row.last_changed_at ?? row.lastChangedAt),
    lastDetailAt: clean(row.last_detail_at ?? row.lastDetailAt)
  };
}

function normalizeCurrent(entry = {}) {
  return {
    ...entry,
    sourceId: clean(entry.sourceId),
    categoryId: clean(entry.categoryId) || null,
    categoryPathIds: Array.isArray(entry.categoryPathIds)
      ? entry.categoryPathIds.map(String)
      : [],
    listingFingerprint: clean(entry.listingFingerprint) || listingFingerprint(entry)
  };
}

export function planIncrementalDelta(
  previousRows = [],
  currentEntries = [],
  { removalMissThreshold = 3, inferMissing = true } = {}
) {
  const previous = previousRows.map(normalizePrevious).filter((row) => row.sourceId);
  const current = currentEntries.map(normalizeCurrent).filter((entry) => entry.sourceId);
  return planListingDelta(previous, current, { removalMissThreshold, inferMissing });
}

export function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
