import { createHash } from 'node:crypto';

const FINGERPRINT_NAMESPACE = 'catalog-engine:supplier-listing:v1';

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function listingFingerprint(entry = {}) {
  const payload = {
    title: clean(entry.title),
    categoryId: clean(entry.categoryId),
    categoryPathIds: Array.isArray(entry.categoryPathIds) ? entry.categoryPathIds.map(clean).filter(Boolean) : [],
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

function normalizePrevious(row = {}) {
  return {
    sourceId: clean(row.album_source_id ?? row.sourceId),
    publicProductId: clean(row.public_product_id ?? row.publicProductId),
    title: clean(row.source_title ?? row.title),
    categoryId: clean(row.source_category_id ?? row.categoryId),
    categoryPathJson: clean(row.source_category_path_json ?? row.categoryPathJson),
    coverUrl: clean(row.cover_source_url ?? row.coverUrl),
    listingFingerprint: clean(row.listing_fingerprint ?? row.listingFingerprint),
    detailFingerprint: clean(row.detail_fingerprint ?? row.detailFingerprint),
    status: clean(row.status || 'active'),
    missCount: Math.max(0, Number(row.miss_count ?? row.missCount ?? 0)),
    firstSeenAt: clean(row.first_seen_at ?? row.firstSeenAt),
    lastSeenAt: clean(row.last_seen_at ?? row.lastSeenAt),
    lastChangedAt: clean(row.last_changed_at ?? row.lastChangedAt),
    lastDetailAt: clean(row.last_detail_at ?? row.lastDetailAt)
  };
}

export function planIncrementalDelta(previousRows = [], currentEntries = [], { removalMissThreshold = 3 } = {}) {
  const threshold = Math.max(2, Number(removalMissThreshold || 3));
  const previousById = new Map(previousRows.map(normalizePrevious).filter((row) => row.sourceId).map((row) => [row.sourceId, row]));
  const currentById = new Map(currentEntries.filter((entry) => clean(entry.sourceId)).map((entry) => [clean(entry.sourceId), entry]));
  const events = [];

  for (const [sourceId, current] of currentById) {
    const previous = previousById.get(sourceId);
    const fingerprint = clean(current.listingFingerprint) || listingFingerprint(current);
    if (!previous) {
      events.push({ type: 'NEW', sourceId, previous: null, current: { ...current, listingFingerprint: fingerprint }, needsDetail: true });
      continue;
    }

    if (previous.status === 'deleted' || previous.status === 'missing') {
      events.push({ type: 'RESTORED', sourceId, previous, current: { ...current, listingFingerprint: fingerprint }, needsDetail: true });
      continue;
    }

    const categoryMoved = previous.categoryId !== clean(current.categoryId) || previous.categoryPathJson !== JSON.stringify(current.categoryPathIds || []);
    const contentChanged = previous.listingFingerprint !== fingerprint;
    if (categoryMoved && !contentChanged) {
      events.push({ type: 'MOVED', sourceId, previous, current: { ...current, listingFingerprint: fingerprint }, needsDetail: false });
    } else if (contentChanged) {
      events.push({ type: categoryMoved ? 'CHANGED_MOVED' : 'CHANGED', sourceId, previous, current: { ...current, listingFingerprint: fingerprint }, needsDetail: true });
    }
  }

  for (const [sourceId, previous] of previousById) {
    if (currentById.has(sourceId) || previous.status === 'deleted') continue;
    const nextMissCount = previous.missCount + 1;
    events.push({
      type: nextMissCount >= threshold ? 'REMOVED' : 'MISSING',
      sourceId,
      previous,
      current: null,
      missCount: nextMissCount,
      needsDetail: false
    });
  }

  const priority = new Map([
    ['NEW', 0], ['RESTORED', 1], ['CHANGED_MOVED', 2], ['CHANGED', 3], ['MOVED', 4], ['MISSING', 5], ['REMOVED', 6]
  ]);
  events.sort((a, b) => (priority.get(a.type) ?? 99) - (priority.get(b.type) ?? 99) || a.sourceId.localeCompare(b.sourceId));

  const summary = {};
  for (const event of events) summary[event.type] = (summary[event.type] || 0) + 1;
  return {
    events,
    detailQueue: events.filter((event) => event.needsDetail).map((event) => event.sourceId),
    summary
  };
}

export function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
