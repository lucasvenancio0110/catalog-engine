const STATE_VERSION = 1;
const MAX_ITEMS = 48;
const MAX_SAFE_PRODUCTS = 24;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_TITLE_CHARS = 160;
const MAX_CATEGORY_LABELS = 4;
const MAX_CATEGORY_LABEL_CHARS = 80;
const MAX_PRIVATE_URL_CHARS = 2048;
const STATE_TTL_MS = 12 * 60 * 60 * 1000;
const USEFUL_PRODUCT_THRESHOLD = 12;

const PRODUCT_ID_PATTERN = /^p_[a-f0-9]{20}$/;
const MEDIA_ID_PATTERN = /^cm_[a-f0-9]{20}$/;
const SEED_ID_PATTERN = /^cs_[a-f0-9]{20}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{32,128}$/;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedText(value, maximum, { allowEmpty = false } = {}) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if ((!text && !allowEmpty) || text.length > maximum) {
    throw new Error('construction_seed_invalid');
  }
  return text;
}

function opaque(value, pattern) {
  const text = String(value || '').trim().toLowerCase();
  if (!pattern.test(text)) throw new Error('construction_seed_invalid');
  return text;
}

function timestamp(value) {
  const text = String(value || '').trim();
  const epoch = Date.parse(text);
  if (!text || !Number.isFinite(epoch)) throw new Error('construction_seed_invalid');
  return new Date(epoch).toISOString();
}

function privateHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_PRIVATE_URL_CHARS) throw new Error('construction_seed_invalid');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('construction_seed_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('construction_seed_invalid');
  }
  return url.href;
}

function categoryLabels(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > MAX_CATEGORY_LABELS) {
    throw new Error('construction_seed_invalid');
  }
  const labels = [];
  for (const value of input) {
    const label = boundedText(value, MAX_CATEGORY_LABEL_CHARS, { allowEmpty: true });
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function normalizePrivateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('construction_seed_invalid');
  }
  const cover = item.cover
    ? {
        mediaId: opaque(item.cover.mediaId, MEDIA_ID_PATTERN),
        sourceUrl: privateHttpsUrl(item.cover.sourceUrl)
      }
    : null;
  return {
    productId: opaque(item.productId, PRODUCT_ID_PATTERN),
    title: boundedText(item.title || 'Produto', MAX_TITLE_CHARS),
    listingFingerprint: opaque(item.listingFingerprint, FINGERPRINT_PATTERN),
    sourceItemUrl: privateHttpsUrl(item.sourceItemUrl),
    cover,
    categories: categoryLabels(item.categories)
  };
}

export function normalizeConstructionSeed(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('construction_seed_invalid');
  }
  if (input.complete !== false || input.readiness !== 'indexed') {
    throw new Error('construction_seed_invalid');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
    throw new Error('construction_seed_invalid');
  }

  const byProduct = new Map();
  for (const raw of input.items) {
    const item = normalizePrivateItem(raw);
    if (!byProduct.has(item.productId)) byProduct.set(item.productId, item);
  }
  if (!byProduct.size) throw new Error('construction_seed_invalid');

  const seed = {
    version: STATE_VERSION,
    seedId: opaque(input.seedId, SEED_ID_PATTERN),
    readiness: 'indexed',
    complete: false,
    observedAt: timestamp(input.observedAt),
    items: [...byProduct.values()].slice(0, MAX_ITEMS)
  };
  if (bytes(seed) > MAX_STATE_BYTES) throw new Error('construction_seed_too_large');
  return seed;
}

function isExpired(state, nowMs = Date.now()) {
  const updated = Date.parse(String(state?.updatedAt || ''));
  return !Number.isFinite(updated) || nowMs - updated > STATE_TTL_MS;
}

export function applyConstructionSeed(previous, input, { now = new Date().toISOString() } = {}) {
  const seed = normalizeConstructionSeed(input);
  const nowIso = timestamp(now);
  const previousState = previous && !isExpired(previous, Date.parse(nowIso)) ? previous : null;

  if (previousState?.seedId === seed.seedId) return previousState;
  if (
    previousState?.observedAt &&
    Date.parse(seed.observedAt) < Date.parse(previousState.observedAt)
  ) {
    return previousState;
  }

  const state = {
    version: STATE_VERSION,
    revision: Math.max(0, Number(previousState?.revision || 0)) + 1,
    seedId: seed.seedId,
    readiness: 'indexed',
    complete: false,
    observedAt: seed.observedAt,
    updatedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + STATE_TTL_MS).toISOString(),
    items: seed.items
  };
  if (bytes(state) > MAX_STATE_BYTES) throw new Error('construction_seed_too_large');
  return state;
}

function safeProduct(item) {
  return {
    id: item.productId,
    title: item.title,
    coverMediaId: item.cover?.mediaId || null,
    categories: [...(item.categories || [])]
  };
}

export function constructionProjection(state, { now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(timestamp(now));
  if (!state || isExpired(state, nowMs)) {
    return {
      version: STATE_VERSION,
      readiness: 'empty',
      ready: false,
      complete: false,
      productCount: 0,
      products: [],
      updatedAt: null
    };
  }
  const products = (state.items || []).slice(0, MAX_SAFE_PRODUCTS).map(safeProduct);
  return {
    version: STATE_VERSION,
    readiness: 'indexed',
    ready: products.length >= USEFUL_PRODUCT_THRESHOLD,
    complete: false,
    productCount: Math.min(MAX_ITEMS, state.items?.length || 0),
    products,
    updatedAt: state.updatedAt || null
  };
}

export function privateConstructionMedia(state, mediaId, { now = new Date().toISOString() } = {}) {
  const safeMediaId = opaque(mediaId, MEDIA_ID_PATTERN);
  if (!state || isExpired(state, Date.parse(timestamp(now)))) return null;
  for (const item of state.items || []) {
    if (item.cover?.mediaId === safeMediaId) {
      return { mediaId: safeMediaId, sourceUrl: item.cover.sourceUrl };
    }
  }
  return null;
}

export class TenantConstructionState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async readState() {
    return (await this.ctx.storage.get('state')) || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'PUT' && url.pathname === '/seed') {
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_STATE_BYTES) return json({ error: 'construction_seed_too_large' }, 413);
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_STATE_BYTES) {
          return json({ error: 'construction_seed_too_large' }, 413);
        }
        let payload;
        try {
          payload = JSON.parse(text || '{}');
        } catch {
          return json({ error: 'construction_seed_invalid' }, 400);
        }
        const state = applyConstructionSeed(await this.readState(), payload);
        await this.ctx.storage.put('state', state);
        return json({ ok: true, revision: state.revision });
      }

      if (request.method === 'GET' && url.pathname === '/projection') {
        return json(constructionProjection(await this.readState()));
      }

      const mediaMatch = url.pathname.match(/^\/media\/(cm_[a-f0-9]{20})$/);
      if (request.method === 'GET' && mediaMatch) {
        const media = privateConstructionMedia(await this.readState(), mediaMatch[1]);
        return media ? json(media) : json({ error: 'construction_media_not_found' }, 404);
      }

      if (request.method === 'DELETE' && url.pathname === '/state') {
        await this.ctx.storage.delete('state');
        return json({ ok: true });
      }

      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const code = String(error?.message || 'construction_state_failed');
      if (code === 'construction_seed_too_large') return json({ error: code }, 413);
      if (code === 'construction_seed_invalid') return json({ error: code }, 400);
      console.error('construction_state_failed', 'construction_state_operation_failed');
      return json({ error: 'construction_state_unavailable' }, 503);
    }
  }
}

export const constructionStateContract = Object.freeze({
  version: STATE_VERSION,
  maxItems: MAX_ITEMS,
  maxSafeProducts: MAX_SAFE_PRODUCTS,
  usefulProductThreshold: USEFUL_PRODUCT_THRESHOLD,
  ttlMs: STATE_TTL_MS
});
