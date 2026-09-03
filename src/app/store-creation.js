const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function clean(value) {
  return String(value || '').trim();
}

export class PortalStoreCreationError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'PortalStoreCreationError';
    this.code = code;
    this.status = status;
  }
}

export function normalizePortalStoreSlug(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

export function buildPortalStoreCreationPayload(input = {}) {
  const name = clean(input.name);
  const slug = normalizePortalStoreSlug(input.slug || name);
  const currency = clean(input.currency || 'BRL').toUpperCase();

  if (name.length < 2 || name.length > 80) {
    throw new PortalStoreCreationError('invalid_store_name');
  }
  if (!STORE_SLUG_PATTERN.test(slug)) {
    throw new PortalStoreCreationError('invalid_store_slug');
  }
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new PortalStoreCreationError('invalid_store_currency');
  }

  return { name, slug, currency };
}

async function responsePayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function requestPortalStoreCreation({ token, input, fetchImpl = fetch }) {
  const bearer = clean(token);
  if (!bearer) throw new PortalStoreCreationError('unauthorized', 401);
  const payload = buildPortalStoreCreationPayload(input);
  const response = await fetchImpl('/api/admin/stores', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json'
    },
    cache: 'no-store',
    body: JSON.stringify(payload)
  });
  const body = await responsePayload(response);

  if (!response.ok) {
    throw new PortalStoreCreationError(body.error || 'admin_temporarily_unavailable', response.status);
  }
  if (!body.store || typeof body.store !== 'object') {
    throw new PortalStoreCreationError('invalid_store_creation_response', 502);
  }

  return {
    store: body.store,
    replayed: body.replayed === true,
    status: response.status
  };
}
