import { createHash } from 'node:crypto';

const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const CONTENT_NAMESPACE = 'catalog-engine:content:v1';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function stableEntityId(prefix, provider, sourceId) {
  const digest = hash(`${PUBLIC_ID_NAMESPACE}|${clean(provider).toLowerCase()}|${clean(sourceId)}`);
  return `${prefix}_${digest.slice(0, 20)}`;
}

export function publicProductId(provider, sourceId) {
  return stableEntityId('p', provider, sourceId);
}

export function publicCategoryId(provider, sourceId) {
  return stableEntityId('c', provider, sourceId);
}

export function contentFingerprint(product = {}) {
  const payload = {
    name: clean(product.name),
    category: clean(product.sourceCategoryName || product.category),
    description: clean(product.description),
    sourceImages: Array.isArray(product.sourceImages)
      ? product.sourceImages.map(clean).filter(Boolean)
      : []
  };

  return hash(`${CONTENT_NAMESPACE}|${JSON.stringify(payload)}`);
}

function emptyChanges() {
  return {
    new: [],
    updated: [],
    restored: [],
    removed: [],
    unobserved: []
  };
}

function sortChanges(changes) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, values]) => [key, [...new Set(values)].sort()])
  );
}

export function reconcileSyncState(previousState, observedProducts, { complete = false, now = new Date().toISOString() } = {}) {
  const previousProducts = previousState?.products && typeof previousState.products === 'object'
    ? previousState.products
    : {};
  const nextProducts = structuredClone(previousProducts);
  const changes = emptyChanges();
  const observedIds = new Set();

  for (const observed of observedProducts || []) {
    const publicId = clean(observed.publicId);
    const contentHash = clean(observed.contentHash);
    if (!/^p_[a-f0-9]{20}$/.test(publicId)) {
      throw new Error(`ID público inválido no sync: ${publicId || '(vazio)'}`);
    }
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new Error(`contentHash inválido para ${publicId}.`);
    }

    observedIds.add(publicId);
    const previous = previousProducts[publicId];

    if (!previous) {
      changes.new.push(publicId);
      nextProducts[publicId] = {
        contentHash,
        firstSeenAt: now,
        lastSeenAt: now,
        status: 'active',
        removedAt: null
      };
      continue;
    }

    if (previous.status === 'removed') {
      changes.restored.push(publicId);
    } else if (previous.contentHash !== contentHash) {
      changes.updated.push(publicId);
    }

    nextProducts[publicId] = {
      ...previous,
      contentHash,
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      status: 'active',
      removedAt: null
    };
  }

  for (const [publicId, previous] of Object.entries(previousProducts)) {
    if (observedIds.has(publicId) || previous.status !== 'active') continue;

    if (complete) {
      changes.removed.push(publicId);
      nextProducts[publicId] = {
        ...previous,
        status: 'removed',
        removedAt: now
      };
    } else {
      changes.unobserved.push(publicId);
    }
  }

  const normalizedChanges = sortChanges(changes);
  return {
    schemaVersion: 1,
    generatedAt: now,
    scope: {
      complete: Boolean(complete)
    },
    products: nextProducts,
    changes: normalizedChanges,
    summary: Object.fromEntries(
      Object.entries(normalizedChanges).map(([key, values]) => [key, values.length])
    )
  };
}
