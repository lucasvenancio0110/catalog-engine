import { planSafeListingDelta } from '../../src/sync/listing-delta.js';

export const TENANT_INCREMENTAL_PLAN_CONTRACT_VERSION = 1;

function text(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function parseCategoryPath(value) {
  if (Array.isArray(value)) return value.map((entry) => text(entry)).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => text(entry)).filter(Boolean);
  } catch {
    const error = new Error('tenant_sync_category_path_invalid');
    error.code = 'tenant_sync_category_path_invalid';
    throw error;
  }
}

function normalizeStatus(value) {
  const status = text(value || 'active').toLowerCase();
  if (!['active', 'missing', 'deleted'].includes(status)) {
    const error = new Error('tenant_sync_index_status_invalid');
    error.code = 'tenant_sync_index_status_invalid';
    throw error;
  }
  return status;
}

export function tenantIndexRowsToListingPrevious(rows = []) {
  return rows.map((row) => ({
    sourceId: text(row.album_source_id ?? row.sourceId),
    publicProductId: text(row.public_product_id ?? row.publicProductId),
    categoryId: nullableText(row.source_category_id ?? row.categoryId),
    categoryPathIds: parseCategoryPath(
      row.source_category_path_json ?? row.categoryPathIds ?? row.categoryPathJson
    ),
    listingFingerprint: text(row.listing_fingerprint ?? row.listingFingerprint),
    detailFingerprint: nullableText(row.detail_fingerprint ?? row.detailFingerprint),
    status: normalizeStatus(row.status),
    missCount: Math.max(0, Number(row.miss_count ?? row.missCount ?? 0))
  }));
}

export function providerScanItemsToListingObservations(items = []) {
  return items.map((item) => ({
    sourceId: text(item.albumSourceId ?? item.sourceId),
    publicProductId: text(item.publicProductId),
    categoryId: nullableText(item.sourceCategoryId ?? item.categoryId),
    categoryPathIds: parseCategoryPath(item.sourceCategoryPath ?? item.categoryPathIds),
    listingFingerprint: text(item.listingFingerprint)
  }));
}

export function knownGoodListingCount(previous = []) {
  return previous.reduce((count, item) => count + (item.status === 'deleted' ? 0 : 1), 0);
}

export function tenantIncrementalEventCounts(plan) {
  const summary = plan?.summary || {};
  return Object.freeze({
    scannedAlbums: Number(plan?.observedCount || 0),
    newCount: Number(summary.NEW || 0),
    changedCount: Number(summary.CHANGED || 0) + Number(summary.CHANGED_MOVED || 0),
    movedCount: Number(summary.MOVED || 0) + Number(summary.CHANGED_MOVED || 0),
    restoredCount: Number(summary.RESTORED || 0),
    missingCount: Number(summary.MISSING || 0),
    removedCount: Number(summary.REMOVED || 0),
    detailFetchCount: Number(plan?.detailQueue?.length || 0)
  });
}

export function planTenantIncrementalScan({
  previousRows = [],
  scan,
  scope,
  removalMissThreshold = 3,
  disqualifyingFailureCount = 0,
  safetyPolicy
} = {}) {
  if (!scan || !Array.isArray(scan.items) || typeof scan.complete !== 'boolean') {
    const error = new Error('tenant_sync_scan_contract_invalid');
    error.code = 'tenant_sync_scan_contract_invalid';
    throw error;
  }

  const previous = tenantIndexRowsToListingPrevious(previousRows);
  const current = providerScanItemsToListingObservations(scan.items);
  const delta = planSafeListingDelta(previous, current, {
    scope,
    knownGoodCount: knownGoodListingCount(previous),
    scanComplete: scan.complete,
    disqualifyingFailureCount,
    removalMissThreshold,
    ...(safetyPolicy ? { safetyPolicy } : {})
  });

  const mutationsAllowed = delta.decision.outcome === 'proceed';
  const detailQueue = mutationsAllowed ? [...delta.detailQueue] : [];
  const result = {
    contractVersion: TENANT_INCREMENTAL_PLAN_CONTRACT_VERSION,
    decision: delta.decision,
    mutationsAllowed,
    observedCount: current.length,
    previousKnownGoodCount: knownGoodListingCount(previous),
    previous,
    current,
    events: [...delta.events],
    detailQueue,
    summary: { ...delta.summary }
  };

  return Object.freeze({
    ...result,
    previous: Object.freeze(result.previous.map((entry) => Object.freeze({ ...entry }))),
    current: Object.freeze(result.current.map((entry) => Object.freeze({ ...entry }))),
    events: Object.freeze(result.events),
    detailQueue: Object.freeze(result.detailQueue),
    summary: Object.freeze(result.summary),
    counts: tenantIncrementalEventCounts(result)
  });
}
