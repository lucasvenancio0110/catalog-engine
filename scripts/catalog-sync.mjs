import { createHash } from 'node:crypto';

const PUBLIC_ID_NAMESPACE = 'catalog-engine:public-id:v1';
const CONTENT_NAMESPACE = 'catalog-engine:content:v1';
const SCOPE_NAMESPACE = 'catalog-engine:scope-id:v1';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function stableEntityId(prefix, provider, sourceId, namespace = PUBLIC_ID_NAMESPACE) {
  const digest = hash(`${namespace}|${clean(provider).toLowerCase()}|${clean(sourceId)}`);
  return `${prefix}_${digest.slice(0, 20)}`;
}

export function publicProductId(provider, sourceId) {
  return stableEntityId('p', provider, sourceId);
}

export function publicCategoryId(provider, sourceId) {
  return stableEntityId('c', provider, sourceId);
}

function canonicalScopeKey(sourceUrl) {
  const url = new URL(sourceUrl);
  url.hash = '';
  for (const transient of ['page', 'tab', 'uid', 'referrercate']) {
    url.searchParams.delete(transient);
  }

  const params = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue)
  );
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);

  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  const search = url.searchParams.toString();
  return `${url.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ''}`;
}

export function publicScopeIdentity(provider, sourceUrl) {
  const url = new URL(sourceUrl);
  const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const kind = /\/categories\/\d+$/i.test(pathname)
    ? 'category'
    : /\/albums$/i.test(pathname)
      ? 'catalog'
      : 'source';
  const id = stableEntityId('s', provider, canonicalScopeKey(sourceUrl), SCOPE_NAMESPACE);
  return { id, kind };
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
    unobserved: [],
    detached: []
  };
}

function sortChanges(changes) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, values]) => [key, [...new Set(values)].sort()])
  );
}

function activeProductIds(products = {}) {
  return Object.entries(products)
    .filter(([, product]) => product?.status === 'active')
    .map(([publicId]) => publicId)
    .sort();
}

function normalizePreviousState(previousState, { scopeId, scopeKind, now }) {
  if (previousState?.schemaVersion === 2 && previousState.products && previousState.scopes) {
    return structuredClone(previousState);
  }

  if (previousState?.schemaVersion === 1 && previousState.products) {
    const products = structuredClone(previousState.products);
    const migrationScopeId = scopeKind === 'catalog'
      ? scopeId
      : stableEntityId('s', 'legacy', 'v07-global-membership', SCOPE_NAMESPACE);
    const timestamp = previousState.generatedAt || now;
    return {
      schemaVersion: 2,
      generatedAt: timestamp,
      scopes: {
        [migrationScopeId]: {
          kind: scopeKind === 'catalog' ? 'catalog' : 'legacy',
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          lastCompleteAt: previousState.scope?.complete ? timestamp : null,
          members: activeProductIds(products)
        }
      },
      products,
      changes: emptyChanges(),
      summary: Object.fromEntries(Object.keys(emptyChanges()).map((key) => [key, 0]))
    };
  }

  return {
    schemaVersion: 2,
    generatedAt: now,
    scopes: {},
    products: {},
    changes: emptyChanges(),
    summary: Object.fromEntries(Object.keys(emptyChanges()).map((key) => [key, 0]))
  };
}

function productHasMembership(scopes, publicId) {
  return Object.values(scopes).some((scope) => Array.isArray(scope?.members) && scope.members.includes(publicId));
}

export function reconcileScopedSyncState(
  previousState,
  observedProducts,
  {
    scopeId,
    scopeKind = 'source',
    complete = false,
    now = new Date().toISOString()
  } = {}
) {
  if (!/^s_[a-f0-9]{20}$/.test(clean(scopeId))) {
    throw new Error(`scopeId inválido no sync: ${scopeId || '(vazio)'}`);
  }
  if (!['catalog', 'category', 'source', 'legacy'].includes(scopeKind)) {
    throw new Error(`scopeKind inválido: ${scopeKind}`);
  }

  const previous = normalizePreviousState(previousState, { scopeId, scopeKind, now });
  const previousProducts = previous.products || {};
  const nextProducts = structuredClone(previousProducts);
  const nextScopes = structuredClone(previous.scopes || {});
  const previousScope = nextScopes[scopeId] || null;
  const previousMembers = new Set(previousScope?.members || []);
  const observedIds = new Set();
  const changes = emptyChanges();

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
    const previousProduct = previousProducts[publicId];

    if (!previousProduct) {
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

    if (previousProduct.status === 'removed') {
      changes.restored.push(publicId);
    } else if (previousProduct.contentHash !== contentHash) {
      changes.updated.push(publicId);
    }

    nextProducts[publicId] = {
      ...previousProduct,
      contentHash,
      firstSeenAt: previousProduct.firstSeenAt || now,
      lastSeenAt: now,
      status: 'active',
      removedAt: null
    };
  }

  const nextMembers = complete ? new Set(observedIds) : new Set([...previousMembers, ...observedIds]);
  const missingFromCurrentScope = [...previousMembers].filter((publicId) => !observedIds.has(publicId));

  if (complete) changes.detached.push(...missingFromCurrentScope);
  else changes.unobserved.push(...missingFromCurrentScope);

  nextScopes[scopeId] = {
    kind: scopeKind,
    firstSeenAt: previousScope?.firstSeenAt || now,
    lastSeenAt: now,
    lastCompleteAt: complete ? now : previousScope?.lastCompleteAt || null,
    members: [...nextMembers].sort()
  };

  // A legacy holding scope exists only when schema v1 was first touched through a non-catalog scope.
  // A future complete catalog scan is authoritative enough to retire that migration safety net.
  if (complete && scopeKind === 'catalog') {
    for (const [candidateScopeId, candidateScope] of Object.entries(nextScopes)) {
      if (candidateScope.kind === 'legacy') delete nextScopes[candidateScopeId];
    }
  }

  if (complete) {
    for (const publicId of missingFromCurrentScope) {
      const previousProduct = nextProducts[publicId];
      if (!previousProduct || previousProduct.status !== 'active') continue;
      if (productHasMembership(nextScopes, publicId)) continue;

      changes.removed.push(publicId);
      nextProducts[publicId] = {
        ...previousProduct,
        status: 'removed',
        removedAt: now
      };
    }
  }

  const normalizedChanges = sortChanges(changes);
  return {
    schemaVersion: 2,
    generatedAt: now,
    scope: {
      id: scopeId,
      kind: scopeKind,
      complete: Boolean(complete)
    },
    scopes: nextScopes,
    products: nextProducts,
    changes: normalizedChanges,
    summary: Object.fromEntries(
      Object.entries(normalizedChanges).map(([key, values]) => [key, values.length])
    )
  };
}

// Backward-compatible single-scope facade kept for existing callers/tests.
export function reconcileSyncState(previousState, observedProducts, options = {}) {
  const scopeId = stableEntityId('s', 'legacy', 'single-scope-facade', SCOPE_NAMESPACE);
  return reconcileScopedSyncState(previousState, observedProducts, {
    scopeId,
    scopeKind: 'legacy',
    ...options
  });
}
